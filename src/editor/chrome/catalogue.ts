/**
 * The catalogue of every command the editor offers, and the palette's ranking. Lazy: used by the
 * palette and the shortcuts sheet only.
 */
import type { EditorMode, SlashItem } from "../../types";
import type { LayoutHost } from "../layouts";
import type { ToolbarEntryItem } from "../toolbar";
import { lazyLabels } from "../i18n-lazy";
import { bindingOf, fmt, labelsOf, selectionElement } from "./kit";

/* ───────────────────────────── the command catalogue ───────────────────────────── */

export type Category = "format" | "blocks" | "insert" | "edit" | "view" | "table" | "plugins";

export type CommandEntry = {
  id: string;
  label: string;
  category: Category;
  /** A binding such as "Mod-b", shown formatted for the platform. */
  shortcut?: string;
  icon?: string;
  keywords?: string[];
  /** Runs the command; the caller has already put focus back in the editor. */
  run(): void;
  /** False hides the entry (a table command outside a table). */
  available?(): boolean;
};

const GROUP_CAT: Record<string, Category> = { text: "format", blocks: "blocks", insert: "insert", table: "table", history: "edit", view: "view", plugins: "plugins" };
const ITEM_CAT: Record<string, Category> = {
  bold: "format", italic: "format", strike: "format", code: "format",
  heading: "blocks", bulletList: "blocks", orderedList: "blocks", taskList: "blocks", blockquote: "blocks", codeBlock: "blocks",
  link: "insert", image: "insert", attach: "insert", table: "insert", math: "insert", rule: "insert", emoji: "insert",
  undo: "edit", redo: "edit",
};
/** Commands that are the chrome's own plumbing, never listed on their own. */
const PLUMBING = new Set(["submit", "codeLanguage", "palette", "contextMenu", "link", "image", "table", "math", "attach", "emoji", "shortcuts", "settings"]);

export const humanize = (id: string) => {
  const s = id.replace(/^plugin:[^:]+:/, "").replace(/[:_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const exec = (host: LayoutHost, cmd: string, args?: unknown) => () => void host.editor.exec(cmd, args);

/**
 * Every command the editor offers right now: toolbar items (built-in and plugin), the heading
 * levels, the slash menu's blocks, the modes, the chrome's own dialogs, table editing (while the
 * caret is in a table), and any other registered command (plugins and the host), named from its id.
 */
export function catalogue(host: LayoutHost, slash: SlashItem[] = []): CommandEntry[] {
  const L = labelsOf(host);
  const ed = host.editor;
  const out: CommandEntry[] = [];
  const seen = new Set<string>();
  const add = (e: CommandEntry) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    out.push(e);
  };
  const fromItem = (it: ToolbarEntryItem, cat: Category) => {
    if (it.render || it.split) return;
    if (it.menu) {
      for (const m of it.menu) add({ id: m.command + (m.args === undefined ? "" : ":" + String(m.args)), label: it.id === "heading" ? m.label : `${it.label}: ${m.label}`, category: cat, shortcut: m.shortcut ?? bindingOf(host, m.command), icon: it.id === "heading" ? "heading" : it.icon, run: exec(host, m.command, m.args) });
      return;
    }
    const cmd = it.command;
    // The item's id is a keyword too: "blockquote" finds Quote, "hr" finds Divider.
    add({ id: typeof cmd === "string" ? cmd : it.id, label: it.label, category: cat, keywords: [it.id], shortcut: it.shortcut, icon: it.icon ? it.id : undefined, run: typeof cmd === "string" ? exec(host, cmd) : () => cmd(ed) });
  };
  for (const it of host.available) fromItem(it, ITEM_CAT[it.id] ?? GROUP_CAT[it.group ?? ""] ?? "plugins");
  if (ed.options.features?.details !== false && !ed.isReadOnly()) add({ id: "details", label: lazyLabels(host.ctx.labels).detailsItem, category: "blocks", icon: "details", keywords: ["collapse", "toggle", "accordion", "spoiler", "summary"], run: exec(host, "details") });
  for (const s of slash) {
    if (seen.has(s.id) || out.some((e) => e.label === s.label)) continue;
    add({ id: "slash:" + s.id, label: s.label, category: "blocks", keywords: s.keywords, icon: undefined, shortcut: s.shortcut, run: () => s.run(ed) });
  }
  add({ id: "clearFormat", label: L.clearFormat, category: "format", shortcut: bindingOf(host, "clearFormat"), icon: "clear", run: exec(host, "clearFormat") });
  const modes: [EditorMode, string, string][] = [["wysiwyg", host.ctx.labels.wysiwyg, "write"], ["markdown", host.ctx.labels.markdown, "hash"], ["split", host.ctx.labels.split, "split"]];
  if (ed.options.allowModeSwitch !== false)
    for (const [m, name, icon] of modes) add({ id: "mode:" + m, label: fmt(L.switchTo, { mode: name }), category: "view", icon, keywords: ["mode", name.toLowerCase()], run: () => ed.setMode(m), available: () => ed.getMode() !== m });
  add({ id: "shortcuts", label: L.shortcuts, category: "view", shortcut: bindingOf(host, "shortcuts"), icon: "keyboard", keywords: ["keys", "help", "cheat sheet"], run: exec(host, "shortcuts") });
  if (ed.options.settings !== false) add({ id: "settings", label: L.settings, category: "view", icon: "settings", keywords: ["preferences", "density", "font", "options"], run: exec(host, "settings") });
  if (host.commands.has("focusMode")) add({ id: "focusMode", label: L.focusMode, category: "view", icon: "focus", keywords: ["zen", "distraction", "fullscreen"], run: exec(host, "focusMode") });
  const inTable = () => !!selectionElement(host)?.closest("td,th");
  const T: [string, string, string][] = [
    ["tableAddRow", "Add row below", "rowAdd"], ["tableAddColumn", "Add column to the right", "colAdd"], ["tableDeleteRow", "Delete row", "rowDel"],
    ["tableDeleteColumn", "Delete column", "colDel"], ["tableAlignLeft", "Align column left", "alignLeft"], ["tableAlignCenter", "Centre column", "alignCenter"],
    ["tableAlignRight", "Align column right", "alignRight"], ["tableDeleteTable", "Delete table", "trash"],
  ];
  for (const [id, en, icon] of T) add({ id, label: L[id] ?? en, category: "table", icon, run: exec(host, id), available: inTable });
  for (const id of host.commands.keys()) {
    if (PLUMBING.has(id) || seen.has(id) || /^(syntax|mode):/.test(id) || id.startsWith("plugin:")) continue;
    add({ id, label: humanize(id), category: "plugins", shortcut: bindingOf(host, id), run: exec(host, id) });
  }
  return out;
}

/* ───────────────────────────── ranking ───────────────────────────── */

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * How well `query` matches `text`, 0 for no match. Exact > prefix > word starts (every query word
 * begins a word, in order) > substring > a subsequence (characters in order), which earns more for
 * runs of consecutive characters and for characters that begin a word. Accents and case are ignored.
 */
export function score(text: string, query: string): number {
  const t = fold(text);
  const q = fold(query).trim();
  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - Math.min(t.length - q.length, 50);
  const words = t.split(/[\s:/_-]+/).filter(Boolean);
  const qs = q.split(/\s+/);
  let wi = 0;
  if (qs.every((w) => { while (wi < words.length && !words[wi].startsWith(w)) wi++; return wi++ < words.length; })) return 700 - words.length;
  const at = t.indexOf(q);
  if (at >= 0) return 500 - at;
  let s = 0, run = 0, ti = 0;
  for (const ch of q.replace(/\s+/g, "")) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    run = found === ti ? run + 1 : 1;
    s += 2 + run * 3 + (found === 0 || /[\s:/_-]/.test(t[found - 1]) ? 6 : 0);
    ti = found + 1;
  }
  return Math.min(300, 50 + s);
}

/**
 * Rank `entries` for `query`: the best match of the label (full weight) or a keyword or the
 * category name (lower weight), plus a boost for recently run commands; unmatched entries go, ties
 * keep their order. With an empty query the recent commands come first, most recent first.
 */
export function rankCommands<T extends { id: string; label: string; keywords?: string[]; category?: string }>(entries: T[], query: string, recent: string[] = [], categoryNames: Record<string, string> = {}): T[] {
  const rec = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? 0 : recent.length - i;
  };
  const scored = entries.map((e, i) => {
    let s = score(e.label, query);
    if (query.trim()) {
      for (const k of e.keywords ?? []) s = Math.max(s, score(k, query) * 0.6);
      if (e.category) s = Math.max(s, score(categoryNames[e.category] ?? e.category, query) * 0.4);
      if (s > 0) s += rec(e.id) * 15;
    } else s = 1 + rec(e.id) * 100;
    return { e, s, i };
  });
  return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.e);
}

