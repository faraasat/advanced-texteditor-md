/**
 * Ready-made triggers. A Plugin cannot add mention triggers or chip definitions (both are fixed
 * when the editor is created), so each preset returns the pieces and the host spreads them in:
 *
 *   const tags = createTagTrigger({ tags: ["design", "bug"] });
 *   createEditor(el, { mentions: [people, tags.mentions], chips: [...tags.chips], plugins: [tags.plugin] });
 *
 * `createCommandTrigger` is different: a command is not a chip, so it is only a plugin (its own
 * typeahead plus slash-menu items). Its trigger is ">" by default because "/" is the editor's
 * slash menu.
 */
import type { ChipDefinition, EditorInstance, MentionItem, MentionOptions, Plugin, SlashItem } from "../../types";
import type { MentionController } from "../../features/mentions";
import { caretRect, surfaceOf, textareaOf } from "../_shared";
import type { Surface } from "../../editor/pane-types";
import { matchClass } from "./ranking";
import { chipOfItem, inlineOpeners, wireForTextarea } from "./wire";
import type { TextareaTypeahead } from "./suggest";
import { LIST_LABELS, replaceInTextarea } from "./md-mentions";
import { lazy } from "./lazy";

const MENUS = /* @__PURE__ */ lazy(() => Promise.all([import("../../features/mentions"), import("./suggest")]));

export type TriggerPreset = {
  mentions: MentionOptions;
  chips: ChipDefinition[];
  plugin?: Plugin;
};

const BOUNDARY = /[\s(\[{<"'`,.;:!?\-—–‘“¿¡]/;
const listSearch = (items: MentionItem[]) => (q: string) =>
  items
    .map((it, i) => ({ it, i, c: matchClass(it.label, q) }))
    .filter((x) => x.c < 4)
    .sort((a, b) => a.c - b.c || a.i - b.i)
    .map((x) => x.it);

/* ───────────────────────────── tags ───────────────────────────── */

export type TagTriggerOptions = {
  /** Known tags. Or give `search`. */
  tags?: string[];
  search?: MentionOptions["search"];
  /** Default "#". */
  trigger?: string;
  /** Default "tag". */
  scheme?: string;
  /** Typing `#newtag` then Enter (the "Create" row) or a space makes a chip of a tag not in the list. Default true. */
  allowCreate?: boolean;
  /** What a new tag may look like. Default: letters, digits, `_`, `-`, `/`, 1-50 characters, at least one letter. */
  pattern?: RegExp;
  maxResults?: number;
  labels?: { create?: (tag: string) => string; menu?: string };
};

const TAG_RE = /^(?=.*\p{L})[\p{L}\p{N}_\-/]{1,50}$/u;
const tagId = (t: string) => t.toLowerCase();

export function createTagTrigger(o: TagTriggerOptions = {}): TriggerPreset {
  const trigger = o.trigger || "#";
  const scheme = o.scheme ?? "tag";
  const allowCreate = o.allowCreate !== false;
  const pattern = o.pattern ?? TAG_RE;
  const create = o.labels?.create ?? ((t: string) => `Create ${trigger}${t}`);
  const known = (o.tags ?? []).filter((t) => typeof t === "string" && t).map((t): MentionItem => ({ id: tagId(t), label: t }));
  const base: MentionOptions["search"] = o.search ?? listSearch(known);
  const valid = (q: string) => pattern.test(q);

  const search: MentionOptions["search"] = (q, ctx) => {
    const add = (items: MentionItem[]) => {
      const list = Array.isArray(items) ? items : [];
      if (!allowCreate || !q || !valid(q) || list.some((i) => i.id === tagId(q) || i.label.toLowerCase() === q.toLowerCase())) return list;
      return [
        ...list,
        {
          id: tagId(q),
          label: q,
          description: create(q),
          data: { create: true },
        },
      ];
    };
    const r = base(q, ctx);
    return r && typeof (r as Promise<MentionItem[]>).then === "function" ? (r as Promise<MentionItem[]>).then(add) : add(r as MentionItem[]);
  };

  const mentions: MentionOptions = {
    trigger,
    scheme,
    search,
    allowSpaces: false,
    debounceMs: 60,
    maxResults: o.maxResults ?? 8,
    hideWhenEmpty: true,
  };

  /** `#tag ` just typed (the space included): the range to turn into a chip. */
  const closed = (before: string): { start: number; tag: string } | null => {
    if (!before.endsWith(" ")) return null;
    const head = before.slice(0, -1);
    const at = head.lastIndexOf(trigger);
    if (at < 0 || (at > 0 && !BOUNDARY.test(head[at - 1]))) return null;
    const tag = head.slice(at + trigger.length);
    return tag && valid(tag) ? { start: at, tag } : null;
  };

  const plugin: Plugin = {
    name: "tag-trigger",
    afterInput(ed, info) {
      if (!allowCreate || info?.inputType !== "insertText" || info.data !== " ") return;
      const chipFor = (tag: string) => chipOfItem({ id: tagId(tag), label: tag }, scheme, trigger);
      if (ed.getMode() === "wysiwyg") {
        const s = surfaceOf(ed);
        const sel = s?.ownerDocument.getSelection();
        const n = sel && sel.rangeCount && sel.isCollapsed ? sel.anchorNode : null;
        if (!s || !n || n.nodeType !== 3 || !s.contains(n)) return;
        if (n.parentElement?.closest("code, pre, a")) return;
        const off = sel!.anchorOffset;
        const hit = closed((n as Text).data.slice(0, off));
        if (!hit) return;
        const r = s.ownerDocument.createRange();
        r.setStart(n, hit.start);
        r.setEnd(n, off);
        (ed.getPane() as Surface | null)?.replaceRangeWithChip?.(r, chipFor(hit.tag));
        return;
      }
      const ta = textareaOf(ed);
      if (!ta) return;
      const caret = ta.selectionStart ?? 0;
      const lineStart = ta.value.lastIndexOf("\n", caret - 1) + 1;
      const hit = closed(ta.value.slice(lineStart, caret));
      if (!hit) return;
      const start = lineStart + hit.start;
      const w = wireForTextarea(ta.value, start, caret - 1, chipFor(hit.tag), inlineOpeners(ed));
      replaceInTextarea(ed, ta, w.from, caret, w.text + " ");
    },
  };

  return { mentions, chips: [{ scheme }], plugin };
}

/* ───────────────────────────── channels ───────────────────────────── */

export type ChannelTriggerOptions = {
  channels?: MentionItem[];
  search?: MentionOptions["search"];
  /** Default "~" ("#" is the tag preset's and a Markdown heading's). */
  trigger?: string;
  /** Default "channel". */
  scheme?: string;
  maxResults?: number;
};

export function createChannelTrigger(o: ChannelTriggerOptions = {}): TriggerPreset {
  const scheme = o.scheme ?? "channel";
  const items = (o.channels ?? []).filter((c) => c && typeof c.id === "string" && typeof c.label === "string");
  return {
    mentions: {
      trigger: o.trigger || "~",
      scheme,
      search: o.search ?? listSearch(items),
      allowSpaces: false,
      maxResults: o.maxResults ?? 8,
    },
    chips: [{ scheme }],
  };
}

/* ───────────────────────────── commands ───────────────────────────── */

export type ChipCommand = {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  icon?: string;
  run: (editor: EditorInstance) => void;
};

export type CommandTriggerOptions = {
  commands: ChipCommand[];
  /** Default ">". `false`: no typeahead, only the slash-menu items. Never "/" (the slash menu). */
  trigger?: string | false;
  /** Also list the commands in the editor's slash menu. Default true. */
  slash?: boolean;
  maxResults?: number;
  labels?: { menu?: string };
};

export function createCommandTrigger(o: CommandTriggerOptions): {
  plugin: Plugin;
  slash: SlashItem[];
} {
  const commands = (o.commands ?? []).filter((c) => c && typeof c.id === "string" && typeof c.run === "function");
  const trigger = o.trigger === false ? null : o.trigger && o.trigger !== "/" ? o.trigger : ">";
  const byId = new Map(commands.map((c) => [c.id, c]));
  const items: MentionItem[] = commands.map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description,
  }));
  const find = (q: string) => {
    const kw = (id: string) => (byId.get(id)?.keywords ?? []).some((k) => matchClass(k, q) < 4);
    return items.filter((i) => matchClass(i.label, q) < 4 || kw(i.id)).sort((a, b) => matchClass(a.label, q) - matchClass(b.label, q));
  };
  const slash: SlashItem[] = commands.map((c) => ({
    id: `command:${c.id}`,
    label: c.label,
    description: c.description,
    keywords: c.keywords,
    icon: c.icon,
    run: c.run,
  }));
  const menuOpt: MentionOptions = {
    trigger: trigger ?? ">",
    search: find,
    minChars: 1,
    allowSpaces: false,
    hideWhenEmpty: true,
    debounceMs: 0,
    maxResults: o.maxResults ?? 8,
  };
  const labels = { ...LIST_LABELS, menu: o.labels?.menu ?? "Commands" };
  const per = new WeakMap<EditorInstance, { wys: MentionController | null; md: TextareaTypeahead | null }>();

  const runCmd = (ed: EditorInstance, id: string, remove: () => void) => {
    const c = byId.get(id);
    if (!c) return;
    ed.transact(() => {
      remove();
      try {
        c.run(ed);
      } catch (e) {
        if (typeof console !== "undefined") console.error(e);
      }
    });
  };

  const plugin: Plugin = {
    name: "command-trigger",
    slash: o.slash === false ? undefined : slash,
    afterInput(ed, info) {
      if (info?.inputType === "insertCompositionText") return;
      const st = per.get(ed);
      st?.wys?.notifyInput();
      st?.md?.notifyInput();
    },
    keydown(ev, ed) {
      if (ev.isComposing) return false;
      const st = per.get(ed);
      return !!st && (!!st.wys?.handleKeyDown(ev) || !!st.md?.handleKeyDown(ev));
    },
    setup(ed) {
      if (!trigger || !commands.length) return;
      const st: {
        wys: MentionController | null;
        md: TextareaTypeahead | null;
      } = { wys: null, md: null };
      per.set(ed, st);
      const d = ed.element.ownerDocument;
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
            if (s)
              st.wys = mentions.createMentionController({
                root: s,
                document: d,
                labels: { menu: labels.menu },
                getRect: () => caretRect(d),
                options: [menuOpt],
                onPick: (item, _i, range) =>
                  runCmd(ed, item.id, () => {
                    const sel = d.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                    ed.insertText("");
                  }),
              });
          }
          const t = textareaOf(ed);
          if (t !== ta) {
            st.md?.destroy();
            st.md = null;
            ta = t;
            if (t)
              st.md = suggest.createTextareaTypeahead({
                textarea: t,
                options: [menuOpt],
                labels,
                getRect: () => ed.getPane()?.getCaretRect() ?? null,
                onPick: (item, _i, { start, end }) => runCmd(ed, item.id, () => replaceInTextarea(ed, t, start, end, "")),
              });
          }
        });
      attach();
      const offs = [ed.on("pane", attach), ed.on("mode", attach)];
      return () => {
        offs.forEach((f) => f());
        st.wys?.destroy();
        st.md?.destroy();
        per.delete(ed);
      };
    },
  };
  return { plugin, slash };
}
