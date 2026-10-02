/**
 * The suggestion list both new menus share (the Markdown-pane typeahead and the chip picker),
 * drawn with the SAME classes as the editor's WYSIWYG mention menu (`atm-mention-menu`, `-list`,
 * `-option`, `-avatar`, `-body`, `-label`, `-desc`, `-badge`, `-group`, `-status`), so one
 * stylesheet styles all three. Plus the search runner (first query immediate, later ones debounced,
 * every superseded search aborted) and the textarea typeahead.
 *
 * Every row is built with createElement/textContent; `renderItem` may return the host's own node.
 */
import type { MentionItem, MentionOptions } from "../../types";
import { urlAllowed } from "../../features/upload-policy";
import { detectTrigger } from "../../features/mentions";
import { h } from "../_shared";
import { nextId, place, ZERO } from "./popup";

export type SuggestLabels = {
  /** Live-region text for N results. */
  results: (n: number) => string;
  noResults: string;
  searching: string;
  /** Accessible name of the list. */
  menu: string;
};

export const SUGGEST_LABELS: SuggestLabels = {
  results: (n) => `${n} ${n === 1 ? "result" : "results"}`,
  noResults: "No results",
  searching: "Searching...",
  menu: "Suggestions",
};

function initials(label: string): string {
  const words = String(label ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = (w: string) => Array.from(w)[0] ?? "";
  if (!words.length) return "?";
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : "")).toUpperCase();
}

function colorOf(c: MentionItem["color"]): string | null {
  if (typeof c === "number" && Number.isInteger(c) && c >= 1 && c <= 8) return `var(--atm-chip-${c})`;
  if (typeof c === "string" && c.trim() && !/[;{}<>\\"'`]|url\(|expression/i.test(c)) return c.trim();
  return null;
}

/** Order by `groupBy` (first appearance of each group), as the WYSIWYG menu does. */
export function groupOrder(items: MentionItem[], groupBy?: (i: MentionItem) => string | undefined): MentionItem[] {
  if (!groupBy) return items;
  const order: string[] = [];
  const by = new Map<string, MentionItem[]>();
  for (const i of items) {
    let g = "";
    try {
      g = groupBy(i) ?? "";
    } catch {
      g = "";
    }
    if (!by.has(g)) {
      by.set(g, []);
      order.push(g);
    }
    by.get(g)!.push(i);
  }
  return order.flatMap((g) => by.get(g)!);
}

export type SuggestList = {
  /** The listbox element (aria-controls target). */
  readonly list: HTMLElement;
  /** The whole menu (list + status). */
  readonly menu: HTMLElement;
  render(items: MentionItem[], state: { loading: boolean; opt: Partial<MentionOptions> }): void;
  setActive(i: number, scroll?: boolean): void;
  active(): number;
  count(): number;
  item(i: number): MentionItem | undefined;
  /** id of the active option, or null. */
  activeId(): string | null;
  /** Polite live region (lives in body). */
  announce(text: string): void;
  destroy(): void;
};

export function createSuggestList(
  d: Document,
  cfg: {
    labels: SuggestLabels;
    onPick(i: number): void;
    onActive?(id: string | null): void;
    className?: string;
  },
): SuggestList {
  const id = nextId("suggest");
  const menu = h(d, "div", {
    class: "atm-mention-menu" + (cfg.className ? " " + cfg.className : ""),
  });
  const list = h(d, "div", {
    id: `${id}-list`,
    class: "atm-mention-list",
    role: "listbox",
    "aria-label": cfg.labels.menu,
  });
  const status = h(d, "div", { class: "atm-mention-status" });
  menu.append(list, status);
  const live = h(d, "div", {
    class: "atm-mention-live",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  live.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";
  d.body.append(live);
  let rows: { item: MentionItem; el: HTMLElement }[] = [];
  let active = -1;

  function row(item: MentionItem, i: number, opt: Partial<MentionOptions>): HTMLElement {
    const el = h(d, "div", {
      id: `${id}-opt-${i}`,
      class: "atm-mention-option",
      role: "option",
      "aria-selected": "false",
    });
    const color = colorOf(item.color);
    if (color) el.style.setProperty("--atm-chip-color", color);
    let custom: HTMLElement | string | null | undefined;
    try {
      custom = opt.renderItem?.(item);
    } catch {
      custom = undefined;
    }
    if (custom !== undefined && custom !== null) {
      el.append(typeof custom === "string" ? d.createTextNode(custom) : custom);
      return el;
    }
    const avatar = h(d, "span", {
      class: "atm-mention-avatar",
      "aria-hidden": "true",
    });
    if (typeof item.avatarUrl === "string" && urlAllowed(item.avatarUrl, { allowedSchemes: ["http", "https"] }, "image")) {
      avatar.append(h(d, "img", { src: item.avatarUrl, alt: "", loading: "lazy" }));
    } else avatar.textContent = item.kind === "group" ? "" : initials(item.label);
    if (item.kind === "group") avatar.classList.add("atm-mention-avatar-group");
    const body = h(d, "span", { class: "atm-mention-body" }, h(d, "span", { class: "atm-mention-label" }, String(item.label ?? "")));
    if (item.description) body.append(h(d, "span", { class: "atm-mention-desc" }, String(item.description)));
    el.append(avatar, body);
    if (item.badge) el.append(h(d, "span", { class: "atm-mention-badge" }, String(item.badge)));
    return el;
  }

  const api: SuggestList = {
    list,
    menu,
    render(items, { loading, opt }) {
      list.textContent = "";
      rows = [];
      list.setAttribute("aria-busy", loading && !items.length ? "true" : "false");
      let group: HTMLElement | null = null;
      let last: string | null = null;
      items.forEach((item, i) => {
        if (opt.groupBy) {
          let g = "";
          try {
            g = opt.groupBy(item) ?? "";
          } catch {
            g = "";
          }
          if (g !== last) {
            last = g;
            group = h(d, "div", {
              role: "group",
              class: "atm-mention-groupbox",
            });
            if (g) {
              const hd = h(d, "div", { id: `${id}-grp-${i}`, class: "atm-mention-group" }, g);
              group.setAttribute("aria-labelledby", hd.id);
              group.append(hd);
            }
            list.append(group);
          }
        }
        const el = row(item, i, opt);
        el.addEventListener("mousedown", (e) => e.preventDefault());
        el.addEventListener("click", (e) => {
          e.preventDefault();
          cfg.onPick(i);
        });
        el.addEventListener("mousemove", () => {
          if (active !== i) api.setActive(i, false);
        });
        (group ?? list).append(el);
        rows.push({ item, el });
      });
      const empty = opt.emptyText ?? cfg.labels.noResults;
      const text = loading && !items.length ? (opt.loadingText ?? cfg.labels.searching) : !loading && !items.length ? empty : "";
      status.textContent = text;
      status.hidden = !text;
      if (!loading) live.textContent = items.length ? cfg.labels.results(items.length) : empty;
      api.setActive(items.length ? Math.min(Math.max(active, 0), items.length - 1) : -1, false);
    },
    setActive(i, scroll = true) {
      active = rows.length ? i : -1;
      rows.forEach((r, n) => r.el.setAttribute("aria-selected", n === active ? "true" : "false"));
      if (active >= 0 && scroll) rows[active].el.scrollIntoView?.({ block: "nearest" });
      cfg.onActive?.(api.activeId());
    },
    active: () => active,
    count: () => rows.length,
    item: (i) => rows[i]?.item,
    activeId: () => (active >= 0 && rows[active] ? rows[active].el.id : null),
    announce(text) {
      live.textContent = text;
    },
    destroy() {
      menu.remove();
      live.remove();
    },
  };
  return api;
}

/** Runs a host search: immediate the first time, debounced after; superseded runs are aborted. */
export function createSearchRunner(onResult: (items: MentionItem[] | null, loading: boolean) => void) {
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ac: AbortController | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    ac?.abort();
    ac = null;
    seq++;
  };
  return {
    cancel,
    run(
      search: MentionOptions["search"],
      query: string,
      opt: {
        immediate: boolean;
        debounceMs?: number;
        maxResults?: number;
        groupBy?: MentionOptions["groupBy"];
      },
    ) {
      cancel();
      const mine = seq;
      const go = () => {
        timer = null;
        if (mine !== seq) return;
        const c = new AbortController();
        ac = c;
        const done = (r: MentionItem[] | null) => {
          if (mine !== seq || c.signal.aborted) return;
          ac = null;
          const items = Array.isArray(r) ? r.filter((x) => x && typeof x === "object").slice(0, opt.maxResults ?? 8) : [];
          onResult(groupOrder(items, opt.groupBy), false);
        };
        let r: MentionItem[] | Promise<MentionItem[]>;
        try {
          r = search(query, { signal: c.signal });
        } catch {
          r = [];
        }
        if (r && typeof (r as Promise<MentionItem[]>).then === "function") {
          onResult(null, true);
          (r as Promise<MentionItem[]>).then(done, () => done([]));
        } else done(r as MentionItem[]);
      };
      const wait = opt.debounceMs ?? 100;
      if (opt.immediate || !wait) go();
      else timer = setTimeout(go, wait);
    },
  };
}

/* ───────────────────────────── textarea typeahead ───────────────────────────── */

export type TextareaTypeahead = {
  notifyInput(): void;
  handleKeyDown(ev: KeyboardEvent): boolean;
  isOpen(): boolean;
  close(): void;
  destroy(): void;
};

export type TextareaTypeaheadConfig = {
  textarea: HTMLTextAreaElement;
  options: MentionOptions[];
  labels: SuggestLabels;
  /** Caret rectangle in viewport coordinates (the Markdown pane's mirror measurement). */
  getRect: () => DOMRect | null;
  /** `start` is where the trigger begins, `end` the caret. */
  onPick: (item: MentionItem, optionIndex: number, range: { start: number; end: number }) => void;
};

/**
 * The mention typeahead for a `<textarea>`. Same detection (`detectTrigger`), same options and the
 * same keys as the WYSIWYG menu. Nothing happens during an IME composition.
 */
export function createTextareaTypeahead(cfg: TextareaTypeaheadConfig): TextareaTypeahead {
  const ta = cfg.textarea;
  const d = ta.ownerDocument;
  const win = d.defaultView;
  const opts = cfg.options.map((o) => ({ ...o, trigger: o.trigger || "@" }));
  let current: { opt: number; start: number; query: string } | null = null;
  let dismissed: number | null = null; // trigger start Escape closed
  let items: MentionItem[] = [];
  let loading = false;
  let open = false;
  let composing = false;
  let destroyed = false;

  const list = createSuggestList(d, {
    labels: cfg.labels,
    onPick: (i) => pick(i),
    onActive: (aid) => {
      if (aid && open) ta.setAttribute("aria-activedescendant", aid);
      else ta.removeAttribute("aria-activedescendant");
    },
  });
  list.menu.style.cssText = "position:fixed;z-index:1000;left:0;top:0;overflow:auto";

  const runner = createSearchRunner((r, isLoading) => {
    if (!current || destroyed) return;
    loading = isLoading;
    if (r) items = r;
    if (!isLoading && !items.length && /\s\s$/.test(current.query)) return close();
    render();
  });

  function render() {
    if (!current) return;
    const o = opts[current.opt];
    if (o.hideWhenEmpty && !items.length) return hide();
    if (!open) {
      d.body.append(list.menu);
      open = true;
      ta.setAttribute("aria-controls", list.list.id);
      listen(true);
    }
    list.render(items, { loading, opt: o });
    reposition();
  }

  function reposition() {
    if (!open) return;
    let r: DOMRect | null = null;
    try {
      r = cfg.getRect();
    } catch {
      r = null;
    }
    place(list.menu, r ?? ta.getBoundingClientRect?.() ?? ZERO, win, 4);
  }

  function hide() {
    if (!open) return;
    open = false;
    list.menu.remove();
    ta.removeAttribute("aria-controls");
    ta.removeAttribute("aria-activedescendant");
    list.announce("");
    listen(false);
  }

  function close() {
    runner.cancel();
    hide();
    current = null;
    items = [];
    loading = false;
  }

  let listening = false;
  function listen(on: boolean) {
    if (on === listening) return;
    listening = on;
    const m = on ? "addEventListener" : "removeEventListener";
    d[m]("mousedown", onOutside, true);
    win?.[m]("resize", reposition);
    win?.[m]("scroll", reposition, true);
  }
  function onOutside(e: Event) {
    const t = e.target as Node | null;
    if (t && (list.menu.contains(t) || t === ta)) return;
    close();
  }

  function pick(i: number) {
    if (!current) return;
    const item = list.item(i);
    if (!item) return;
    const { start, opt } = current;
    const end = ta.selectionStart ?? start;
    close();
    cfg.onPick(item, opt, { start, end });
  }

  function evaluate() {
    if (destroyed || composing) return;
    const s = ta.selectionStart ?? 0;
    if (s !== ta.selectionEnd || d.activeElement !== ta) {
      dismissed = null;
      return close();
    }
    const lineStart = ta.value.lastIndexOf("\n", s - 1) + 1;
    const before = ta.value.slice(Math.max(lineStart, s - 200), s);
    const base = s - before.length;
    let best: { opt: number; start: number; query: string } | null = null;
    opts.forEach((o, i) => {
      const m = detectTrigger(before, [o.trigger], o.allowSpaces !== false);
      // A trigger inside link text that is already closed (`[@Jane](mention:u1) `, the text a pick
      // just wrote) is not an open mention.
      if (m && /\]\(/.test(m.query)) return;
      if (m && (!best || base + m.start > best.start)) best = { opt: i, start: base + m.start, query: m.query };
    });
    const hit = best as { opt: number; start: number; query: string } | null;
    if (!hit) {
      dismissed = null;
      return close();
    }
    if (dismissed !== null && dismissed !== hit.start) dismissed = null;
    if (dismissed !== null) return close();
    const o = opts[hit.opt];
    if (hit.query.length < (o.minChars ?? 0)) return close();
    if (/\s\s/.test(hit.query) && !items.length && !loading) return close();
    const isNew = !current || current.start !== hit.start || current.opt !== hit.opt;
    const changed = isNew || current!.query !== hit.query;
    current = hit;
    if (isNew) {
      items = [];
      runner.run(o.search, hit.query, {
        immediate: true,
        maxResults: o.maxResults,
        groupBy: o.groupBy,
      });
    } else if (changed)
      runner.run(o.search, hit.query, {
        immediate: false,
        debounceMs: o.debounceMs,
        maxResults: o.maxResults,
        groupBy: o.groupBy,
      });
    else reposition();
  }

  const onCompStart = () => {
    composing = true;
  };
  const onCompEnd = () => {
    composing = false;
    setTimeout(evaluate, 0);
  };
  const onCaret = () => {
    if (open || current || dismissed !== null) evaluate();
  };
  const onBlur = () => close();
  ta.addEventListener("compositionstart", onCompStart);
  ta.addEventListener("compositionend", onCompEnd);
  ta.addEventListener("click", onCaret);
  ta.addEventListener("keyup", onCaret);
  ta.addEventListener("blur", onBlur);

  return {
    notifyInput: evaluate,
    isOpen: () => open,
    close,
    handleKeyDown(ev) {
      if (!open || destroyed || composing || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
      const n = list.count();
      switch (ev.key) {
        case "Escape":
          dismissed = current?.start ?? null;
          close();
          return true;
        case "ArrowDown":
          if (!n) return false;
          list.setActive((list.active() + 1) % n);
          return true;
        case "ArrowUp":
          if (!n) return false;
          list.setActive((list.active() - 1 + n) % n);
          return true;
        case "Home":
          if (!n) return false;
          list.setActive(0);
          return true;
        case "End":
          if (!n) return false;
          list.setActive(n - 1);
          return true;
        case "Enter":
        case "Tab":
          if (!n || list.active() < 0) return false;
          pick(list.active());
          return true;
        default:
          return false;
      }
    },
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      ta.removeEventListener("compositionstart", onCompStart);
      ta.removeEventListener("compositionend", onCompEnd);
      ta.removeEventListener("click", onCaret);
      ta.removeEventListener("keyup", onCaret);
      ta.removeEventListener("blur", onBlur);
      list.destroy();
    },
  };
}
