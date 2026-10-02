/**
 * Wiki links: type `[[`, search the host's pages, pick one, and a chip `[Title](wiki:id)` is
 * stored. A preset on the chips v2 system, built the way `createTagTrigger` is: it returns the
 * pieces (`chips`, `plugin`) for the host to spread into `createEditor`.
 *
 * Why there is no `mentions` entry: the editor's own mention menu writes the trigger into the chip
 * (`trigger: "[["`), which would store `[[[Title](wiki:id)`. The plugin therefore runs the same
 * menu controllers itself (`createMentionController` in the Write view, the textarea typeahead in
 * the Markdown view) and inserts a chip with no trigger, as `createCommandTrigger` does.
 *
 * Broken-link detection is decoration only: a chip whose page `resolve` says does not exist gets a
 * class, `data-atm-wiki="broken"`, a `title` and an `aria-description`. Attributes, never nodes, so
 * `getValue()` is the same with and without them. The stored Markdown is a plain link.
 */
import type { ChipDefinition, EditorInstance, MentionItem, MentionOptions, Plugin, PostRenderContext } from "../../types";
import type { MentionController } from "../../features/mentions";
import type { Surface } from "../../editor/pane-types";
import { caretRect, surfaceOf, textareaOf } from "../_shared";
import { chipOfElement, wireForTextarea, inlineOpeners, type Chip } from "../chips/wire";
import { lazy } from "../chips/lazy";
import type { TextareaTypeahead, SuggestLabels } from "../chips/suggest";
import { findWikiIds } from "./scan";
import { createResolver, type PageStatus, type ResolvePages, type Resolver } from "./resolver";

const MENUS = /* @__PURE__ */ lazy(() => Promise.all([import("../../features/mentions"), import("../chips/suggest")]));

export type WikiLabels = {
  /** Name of the suggestion list. */
  menu: string;
  /** Shown on a chip whose page does not exist (`title` and `aria-description`). */
  notFound: string;
  /** The "create" row; `q` is the typed text. */
  create: (q: string) => string;
  noResults: string;
  searching: string;
  results: (n: number) => string;
};

export const DEFAULT_WIKI_LABELS: WikiLabels = {
  menu: "Pages",
  notFound: "Page not found",
  create: (q) => `Create page “${q}”`,
  noResults: "No pages found",
  searching: "Searching...",
  results: (n) => `${n} ${n === 1 ? "page" : "pages"}`,
};

export type WikiLinksOptions = {
  /** Pages matching what was typed after `[[`. `label` is the title, `id` the page id. */
  search: MentionOptions["search"];
  /**
   * Which of these pages exist now? One call per batch of up to `batchSize` ids, cached, debounced
   * after edits, aborted when the last editor is destroyed. Without it nothing is marked broken.
   * An id missing from the answer counts as not found.
   */
  resolve?: ResolvePages;
  /** Adds a "Create page" row for text no page matches. Return the new page, or null to do nothing. */
  create?: (query: string, ctx: { signal: AbortSignal }) => MentionItem | null | Promise<MentionItem | null>;
  /** A wiki chip was clicked, or Enter was pressed on it. */
  onOpen?: (id: string, chip: Chip, ev?: Event) => void;
  /** Default "wiki". */
  scheme?: string;
  /** Default "[[". Two characters or more; "[" alone would fight `[text](url)`. */
  trigger?: string;
  maxResults?: number;
  /** Search debounce, ms. Default 100. */
  debounceMs?: number;
  /** Delay between an edit and the lookup of the ids in the document, ms. Default 400. */
  resolveDelayMs?: number;
  /** Ids per `resolve` call (50), cache entries (500) and how long an answer is trusted, ms (300000). */
  batchSize?: number;
  cacheSize?: number;
  ttlMs?: number;
  classPrefix?: string;
  labels?: Partial<WikiLabels>;
};

export type WikiLinks = {
  /** Spread into `createEditor({ chips })` and `renderDom(md, { chips })`. */
  chips: ChipDefinition[];
  plugin: Plugin;
  scheme: string;
  /** What `resolve` last said about a page; undefined when unknown. */
  status(id: string): PageStatus | undefined;
  /** Look pages up now (batched, cached). */
  lookup(ids: string[]): Promise<Map<string, PageStatus>>;
  /** Forget what was resolved and look the document's pages up again. */
  refresh(): void;
  /** Subscribe to new answers from `resolve`. */
  onStatus(fn: () => void): () => void;
  /** For read-only views: `renderDom(md, { chips, postRender: [wiki.postRender] })`. */
  postRender(root: HTMLElement, ctx: PostRenderContext): void;
  /** Abort lookups in flight and stop timers. The plugin does this by itself when its last editor is destroyed. */
  destroy(): void;
  readonly labels: WikiLabels;
};

const MAX_IDS = 500;
const CONTROL_QUERY = /[\][\n\r]/;

export function createWikiLinks(options: WikiLinksOptions): WikiLinks {
  const scheme = (options.scheme ?? "wiki").toLowerCase();
  const trigger = options.trigger && options.trigger.length >= 2 ? options.trigger : "[[";
  const p = options.classPrefix ?? "atm";
  const labels: WikiLabels = { ...DEFAULT_WIKI_LABELS, ...options.labels };
  const delay = options.resolveDelayMs ?? 400;
  const resolver: Resolver | null = options.resolve
    ? createResolver({ resolve: options.resolve, batchSize: options.batchSize, cacheSize: options.cacheSize, ttlMs: options.ttlMs })
    : null;
  const editors = new Set<EditorInstance>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const per = new WeakMap<EditorInstance, { wys: MentionController | null; md: TextareaTypeahead | null; schedule(now?: boolean): void }>();
  let destroyed = false;

  const open = (chip: Chip, ev?: Event) => {
    if (!chip.id) return;
    try {
      options.onOpen?.(chip.id, chip, ev);
    } catch (e) {
      if (typeof console !== "undefined") console.error(e);
    }
  };

  /* ── decoration (attributes only) ── */

  const MARK = "data-atm-wiki";
  function decorate(el: HTMLElement): void {
    const st = resolver?.peek(el.getAttribute("data-id") ?? "");
    const was = el.getAttribute(MARK);
    if (st && st.exists === false) {
      if (was === "broken") return;
      el.setAttribute(MARK, "broken");
      el.classList.add(`${p}-wiki-broken`);
      el.setAttribute("title", labels.notFound);
      el.setAttribute("aria-description", labels.notFound);
    } else {
      if (was === "broken") {
        el.classList.remove(`${p}-wiki-broken`);
        el.removeAttribute("title");
        el.removeAttribute("aria-description");
      }
      if (st) el.setAttribute(MARK, "ok");
      else el.removeAttribute(MARK);
    }
  }
  const chipsIn = (root: ParentNode): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(`.${p}-chip[data-scheme="${scheme}"]`));
  const decorateAll = (root: ParentNode) => chipsIn(root).forEach(decorate);

  function wireView(root: HTMLElement) {
    for (const el of chipsIn(root)) {
      if (el.hasAttribute("data-atm-wiki-bound")) continue;
      el.setAttribute("data-atm-wiki-bound", "");
      el.setAttribute("role", "link");
      el.setAttribute("tabindex", "0");
      el.addEventListener("keydown", (ev) => {
        if ((ev.key === "Enter" || ev.key === " ") && !ev.isComposing) {
          ev.preventDefault();
          open(chipOfElement(el, p), ev);
        }
      });
    }
  }

  /** Look up the pages named in `ids`, then run `then`. */
  function lookupThen(ids: string[], then: () => void) {
    if (!resolver || !ids.length || destroyed) return;
    resolver.lookup(ids.slice(0, MAX_IDS)).then(() => {
      if (!destroyed) then();
    });
  }

  /* ── the typeahead ── */

  const create = options.create;
  const find: MentionOptions["search"] = (q, ctx) => {
    if (CONTROL_QUERY.test(q)) return [];
    const add = (r: MentionItem[]): MentionItem[] => {
      const list = (Array.isArray(r) ? r : []).filter((i) => i && typeof i === "object" && typeof i.id === "string" && typeof i.label === "string" && i.id);
      const t = q.trim();
      if (create && t && !list.some((i) => i.label.trim().toLowerCase() === t.toLowerCase())) {
        list.push({ id: "", label: labels.create(t), badge: undefined, data: { wikiCreate: t } });
      }
      return list;
    };
    let r: ReturnType<MentionOptions["search"]>;
    try {
      r = options.search(q, ctx);
    } catch {
      r = [];
    }
    return r && typeof (r as Promise<MentionItem[]>).then === "function" ? (r as Promise<MentionItem[]>).then(add, () => add([])) : add(r as MentionItem[]);
  };
  const menuOpt: MentionOptions = {
    trigger,
    scheme,
    search: find,
    allowSpaces: true,
    debounceMs: options.debounceMs ?? 100,
    maxResults: options.maxResults ?? 8,
  };
  const listLabels: SuggestLabels = { results: labels.results, noResults: labels.noResults, searching: labels.searching, menu: labels.menu };

  const chipOf = (item: MentionItem): Omit<Chip, "type"> => {
    const c: Omit<Chip, "type"> = { scheme, kind: item.kind ?? "", id: String(item.id), label: String(item.label ?? "").replace(/[\r\n]+/g, " ") };
    if (item.refs && typeof item.refs === "object") {
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(item.refs)) if (k && k !== "__proto__" && typeof v === "string") attrs[k] = v;
      if (Object.keys(attrs).length) c.attrs = attrs;
    }
    return c;
  };

  /** Create a page (sync or async), then hand it to `insert`. */
  function makePage(query: string, insert: (item: MentionItem) => void) {
    const ac = new AbortController();
    let r: MentionItem | null | Promise<MentionItem | null>;
    try {
      r = create!(query, { signal: ac.signal });
    } catch {
      return;
    }
    Promise.resolve(r).then(
      (item) => {
        if (item && typeof item.id === "string" && item.id && !destroyed) {
          resolver?.invalidate(item.id);
          insert({ ...item, label: typeof item.label === "string" && item.label ? item.label : query });
        }
      },
      () => {},
    );
  }

  /* ── keyboard: Enter on a selected chip opens the page ── */

  function openSelected(ev: KeyboardEvent, ed: EditorInstance): boolean {
    if (ev.key !== "Enter" || ev.isComposing || ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey || !options.onOpen) return false;
    const s = surfaceOf(ed);
    if (!s || ed.getMode() !== "wysiwyg") return false;
    const sel = s.ownerDocument.getSelection();
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!r || r.collapsed || r.startContainer !== r.endContainer || r.endOffset - r.startOffset !== 1) return false;
    const n = r.startContainer.childNodes[r.startOffset] as HTMLElement | undefined;
    if (!n || n.nodeType !== 1 || !n.classList.contains(`${p}-chip`) || n.getAttribute("data-scheme") !== scheme || !s.contains(n)) return false;
    open(chipOfElement(n, p), ev);
    return true;
  }

  /* ── is the caret in code? ── */

  const inCodeText = (value: string, pos: number): boolean => {
    let fence: string | null = null;
    let i = 0;
    while (i <= pos) {
      let e = value.indexOf("\n", i);
      if (e < 0) e = value.length;
      const line = value.slice(i, e);
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      } else if (m) fence = m[1];
      if (e >= pos) break;
      i = e + 1;
    }
    if (fence) return true;
    const ls = value.lastIndexOf("\n", pos - 1) + 1;
    const head = value.slice(ls, pos);
    const at = head.lastIndexOf(trigger);
    return at >= 0 && (head.slice(0, at).split("`").length - 1) % 2 === 1;
  };

  const plugin: Plugin = {
    name: "wiki-links",
    afterInput(ed, info) {
      if (info?.inputType === "insertCompositionText") return;
      const st = per.get(ed);
      if (!st) return;
      st.schedule();
      if (ed.getMode() === "wysiwyg") {
        const sel = ed.element.ownerDocument.getSelection();
        const n = sel && sel.rangeCount ? sel.anchorNode : null;
        const el = n ? (n.nodeType === 1 ? (n as Element) : n.parentElement) : null;
        if (el?.closest("code, pre, a")) return;
        st.wys?.notifyInput();
        return;
      }
      const ta = textareaOf(ed);
      if (!ta || !st.md) return;
      const caret = ta.selectionStart ?? 0;
      const ls = ta.value.lastIndexOf("\n", caret - 1) + 1;
      if (ta.value.slice(ls, caret).includes(trigger) && inCodeText(ta.value, caret)) st.md.close();
      else st.md.notifyInput();
    },
    keydown(ev, ed) {
      if (ev.isComposing) return false;
      const st = per.get(ed);
      return !!st && (!!st.wys?.handleKeyDown(ev) || !!st.md?.handleKeyDown(ev) || openSelected(ev, ed));
    },
    postRender(root, ctx) {
      // Keep the elements: renderDom moves them out of a detached wrapper, so the root is useless later.
      const els = chipsIn(root);
      els.forEach(decorate);
      if (ctx.mode === "view") wireView(root);
      lookupThen(
        els.map((c) => c.getAttribute("data-id") ?? ""),
        () => els.forEach(decorate),
      );
    },
    setup(ed) {
      editors.add(ed);
      destroyed = false;
      const d = ed.element.ownerDocument;
      const st: { wys: MentionController | null; md: TextareaTypeahead | null; schedule(now?: boolean): void } = { wys: null, md: null, schedule: () => {} };
      per.set(ed, st);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const idsNow = (): string[] => {
        const s = ed.getMode() === "wysiwyg" ? surfaceOf(ed) : null;
        if (s) return Array.from(new Set(chipsIn(s).map((c) => c.getAttribute("data-id") ?? "").filter(Boolean)));
        return findWikiIds(ed.getValue(), scheme);
      };
      const run = () => {
        timer = null;
        if (!resolver || destroyed) return;
        lookupThen(idsNow(), () => {
          const s = surfaceOf(ed);
          if (s) decorateAll(s);
        });
      };
      st.schedule = (now) => {
        if (!resolver) return;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(run, now ? 0 : delay);
        timers.add(timer);
      };
      const offUpdate = resolver?.onUpdate(() => {
        const s = surfaceOf(ed);
        if (s && ed.getMode() === "wysiwyg") decorateAll(s);
      });

      let root: HTMLElement | null = null;
      let ta: HTMLTextAreaElement | null = null;
      const attach = () =>
        MENUS.use(([mentions, suggest]) => {
          if (per.get(ed) !== st) return;
          const s = ed.getMode() === "wysiwyg" ? surfaceOf(ed) : null;
          if (s !== root) {
            st.wys?.destroy();
            st.wys = null;
            root = s;
            if (s) {
              st.wys = mentions.createMentionController({
                root: s,
                document: d,
                labels: { menu: labels.menu, noResults: labels.noResults, searching: labels.searching, results: labels.results },
                getRect: () => caretRect(d),
                options: [menuOpt],
                onPick: (item, _i, range) => {
                  const insert = (it: MentionItem) => {
                    const surface = ed.getPane() as Surface | null;
                    if (!surface?.replaceRangeWithChip) return;
                    // The range may have moved while a page was being created: use it only if it is still in the surface.
                    if (range.startContainer.isConnected && s.contains(range.startContainer)) surface.replaceRangeWithChip(range, chipOf(it));
                    else ed.insertChip(chipOf(it));
                  };
                  const q = (item.data as { wikiCreate?: string } | undefined)?.wikiCreate;
                  if (q !== undefined && create) makePage(q, insert);
                  else insert(item);
                },
              });
              st.wys.notifyInput();
            }
          }
          const t = textareaOf(ed);
          if (t !== ta) {
            st.md?.destroy();
            st.md = null;
            ta = t;
            if (t) {
              st.md = suggest.createTextareaTypeahead({
                textarea: t,
                options: [menuOpt],
                labels: listLabels,
                getRect: () => ed.getPane()?.getCaretRect() ?? null,
                onPick: (item, _i, { start, end }) => {
                  const original = t.value.slice(start, end);
                  const insert = (it: MentionItem) => {
                    let from = start;
                    let to = end;
                    // Where the typed text moved to while a page was being created: find it again, else insert at the caret.
                    if (t.value.slice(from, to) !== original) {
                      const at = t.value.indexOf(original);
                      if (at >= 0) {
                        from = at;
                        to = at + original.length;
                      } else from = to = t.selectionStart ?? t.value.length;
                    }
                    const w = wireForTextarea(t.value, from, to, chipOf(it), inlineOpeners(ed));
                    const next = t.value[to];
                    t.focus();
                    t.setSelectionRange(w.from, to);
                    ed.insertText(w.text + (next === " " ? "" : " "));
                  };
                  const q = (item.data as { wikiCreate?: string } | undefined)?.wikiCreate;
                  if (q !== undefined && create) makePage(q, insert);
                  else insert(item);
                },
              });
              st.md.notifyInput();
            }
          }
          st.schedule(true);
        });
      attach();
      st.schedule(true);
      const offs = [ed.on("pane", attach), ed.on("mode", attach), ed.on("change", () => st.schedule())];
      return () => {
        offs.forEach((f) => f());
        offUpdate?.();
        if (timer !== null) clearTimeout(timer);
        st.wys?.destroy();
        st.md?.destroy();
        per.delete(ed);
        editors.delete(ed);
        if (!editors.size) resolver?.abort();
      };
    },
  };

  const chips: ChipDefinition[] = [
    {
      scheme,
      className: `${p}-wiki`,
      onClick: (chip, ev) => {
        if (!options.onOpen) return;
        ev?.preventDefault?.();
        open(chip, ev);
      },
    },
  ];

  return {
    chips,
    plugin,
    scheme,
    labels,
    status: (id) => resolver?.peek(id),
    lookup: (ids) => (resolver ? resolver.lookup(ids) : Promise.resolve(new Map())),
    refresh() {
      resolver?.invalidate();
      for (const ed of editors) per.get(ed)?.schedule(true);
    },
    onStatus: (fn) => resolver?.onUpdate(fn) ?? (() => {}),
    postRender: (root, ctx) => plugin.postRender!(root, ctx),
    destroy() {
      destroyed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      resolver?.abort();
    },
  };
}
