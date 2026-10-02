import { definePlugin } from "./define";
import { createMentionController, type MentionController } from "../features/mentions";
import type { EditorInstance, MentionItem, Plugin } from "../types";

/**
 * `:name:` shortcodes from a table YOU supply (no emoji data ships with the
 * library; the values may be any text).
 *
 *  - Type `:` and two characters and a suggestion menu (an ARIA listbox, the
 *    same one the @mention menu uses) lists the matches. Up/Down move, Enter or
 *    Tab completes, Escape closes. The colon has to start the text or follow a
 *    space or punctuation, so `10:30` and `http://` never open it.
 *  - Typing the closing colon of a known `:name:` replaces it at once.
 *  - Recently used names rank first (kept through `storage`, default
 *    `localStorage`, guarded).
 *  - `editor.exec("insertShortcode", "name")` inserts the value at the caret.
 *
 * What is stored is the real character, never the `:name:` text.
 *
 * DOM assumptions: the WYSIWYG surface is `.atm-surface` and the source pane a
 * `textarea`, both inside `editor.element`. The menu is available in the
 * WYSIWYG view; in Markdown mode the closing colon and `insertShortcode` work,
 * without a menu (a textarea has no text nodes to anchor one to).
 *
 * Built on `createMentionController`, driven through its public options with
 * the trigger `:`.
 */

export type ShortcodesLabels = {
  /** Accessible name of the list. Default "Shortcodes". */
  menu: string;
  /** Shown when nothing matches. Default "No matching shortcode". */
  noResults: string;
};

export type ShortcodesOptions = {
  /** `{ smile: "😀" }`. Names may contain letters, digits, `_`, `+` and `-`. */
  shortcodes: Record<string, string>;
  /** Characters needed after the colon before the menu opens. Default 2. */
  minChars?: number;
  /** Rows in the menu. Default 8. */
  maxResults?: number;
  /** Where recently used names are kept. Default `localStorage`, guarded. */
  storage?: { get(key: string): string | null; set(key: string, value: string): void };
  /** Default "atm-shortcodes-recent". */
  recentKey?: string;
  /** How many recent names to remember. Default 20. */
  maxRecent?: number;
  labels?: Partial<ShortcodesLabels>;
};

const NAME = /^[\w+\-]+$/;
const BOUNDARY = /[\s(\[{<"'`,.;!?\-—–‘“¿¡]/;

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function clean(table: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const k of Object.keys(table ?? {})) if (NAME.test(k) && typeof table[k] === "string" && table[k]) out[k] = table[k];
  return out;
}

/** Names matching `query`, best first: exact, prefix, word start, substring; recent names break ties. */
export function searchShortcodes(table: Record<string, string>, query: string, recent: string[], max: number): string[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const rank = new Map(recent.map((n, i) => [n, i]));
  const scored: { name: string; score: number; r: number }[] = [];
  for (const name of Object.keys(table)) {
    if (!NAME.test(name) || !table[name]) continue;
    const n = name.toLowerCase();
    const at = n.indexOf(q);
    if (at < 0) continue;
    const score = n === q ? 0 : at === 0 ? 1 : /[_+-]/.test(n[at - 1]) ? 2 : 3;
    scored.push({ name, score, r: rank.get(name) ?? Infinity });
  }
  scored.sort((a, b) => a.score - b.score || a.r - b.r || a.name.length - b.name.length || (a.name < b.name ? -1 : 1));
  return scored.slice(0, max).map((s) => s.name);
}

/** Put `name` first, drop duplicates and cap the list. */
export function pushRecent(list: string[], name: string, max: number): string[] {
  return [name, ...list.filter((n) => n !== name)].slice(0, max);
}

/** Does the text before the caret end with a complete, known `:name:` at a word boundary? */
export function findClosedShortcode(before: string, table: Record<string, string>): { start: number; name: string; char: string } | null {
  const m = /:([\w+\-]+):$/.exec(before);
  if (!m) return null;
  const start = m.index;
  if (start > 0 && !BOUNDARY.test(before[start - 1])) return null;
  const name = own(table, m[1]) ? m[1] : Object.keys(table).find((k) => k.toLowerCase() === m[1].toLowerCase());
  if (!name || !table[name]) return null;
  return { start, name, char: table[name] };
}

function guardedLocalStorage(win: Window | null): { get(k: string): string | null; set(k: string, v: string): void } | null {
  try {
    const ls = win?.localStorage;
    return ls ? { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v) } : null;
  } catch {
    return null;
  }
}

/** Also in `src/styles/plugins.css`. */
export const SHORTCODES_CSS = `.atm-sc-item{display:flex;align-items:center;gap:.6rem;min-width:0}
.atm-sc-char{flex:none;min-width:1.4em;text-align:center;font-size:1.2em;line-height:1}
.atm-sc-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--atm-muted,#59636e)}`;

/** See the file header. Command: `insertShortcode`. */
export function createShortcodesPlugin(options: ShortcodesOptions): Plugin {
  const table = clean(options.shortcodes);
  const labels: ShortcodesLabels = { menu: "Shortcodes", noResults: "No matching shortcode", ...options.labels };
  const minChars = options.minChars ?? 2;
  const maxResults = options.maxResults ?? 8;
  const maxRecent = options.maxRecent ?? 20;
  const recentKey = options.recentKey ?? "atm-shortcodes-recent";

  return definePlugin({
    name: "shortcodes",
    commands: {},
    css: SHORTCODES_CSS,
    setup(ed: EditorInstance) {
      const el = ed.element;
      const doc = el.ownerDocument;
      const win = doc.defaultView as (Window & typeof globalThis) | null;
      const storage = options.storage ?? guardedLocalStorage(win);
      let recent: string[] = [];
      try {
        const raw = storage?.get(recentKey);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) recent = parsed.filter((n): n is string => typeof n === "string").slice(0, maxRecent);
      } catch {
        recent = [];
      }
      const remember = (name: string) => {
        recent = pushRecent(recent, name, maxRecent);
        try {
          storage?.set(recentKey, JSON.stringify(recent));
        } catch {
          /* the list just stays in memory */
        }
      };
      const lookup = (name: string): string | null => {
        const clean_ = name.replace(/^:|:$/g, "");
        if (own(table, clean_)) return clean_;
        return Object.keys(table).find((k) => k.toLowerCase() === clean_.toLowerCase()) ?? null;
      };

      const insert = (name: string): boolean => {
        const key = lookup(name);
        if (!key) return false;
        ed.insertText(table[key]);
        remember(key);
        return true;
      };

      /* ── the menu (WYSIWYG) ── */
      let ctl: MentionController | null = null;
      let root: HTMLElement | null = null;

      const surfaceEl = () => el.querySelector<HTMLElement>(".atm-surface");

      const attach = () => {
        const s = surfaceEl();
        if (s === root) return;
        ctl?.destroy();
        ctl = null;
        root = s;
        if (!s) return;
        ctl = createMentionController({
          root: s,
          document: doc,
          labels: { menu: labels.menu, noResults: labels.noResults },
          getRect: () => {
            const sel = doc.getSelection();
            const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
            const rect = r && typeof r.getBoundingClientRect === "function" ? r.getBoundingClientRect() : null;
            return rect ?? ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect);
          },
          options: [
            {
              trigger: ":",
              minChars,
              allowSpaces: false,
              maxResults,
              debounceMs: 0,
              emptyText: labels.noResults,
              search: (q): MentionItem[] => searchShortcodes(table, q, recent, maxResults).map((name) => ({ id: name, label: name, data: table[name] })),
              renderItem: (item) => {
                const row = doc.createElement("span");
                row.className = "atm-sc-item";
                const c = doc.createElement("span");
                c.className = "atm-sc-char";
                c.setAttribute("aria-hidden", "true");
                c.textContent = String(item.data ?? "");
                const n = doc.createElement("span");
                n.className = "atm-sc-name";
                n.textContent = `:${item.id}:`;
                row.append(c, n);
                return row;
              },
            },
          ],
          onPick: (item, _i, range) => {
            const s = doc.getSelection();
            s?.removeAllRanges();
            s?.addRange(range);
            insert(item.id);
          },
        });
      };

      const inSurface = (n: EventTarget | null) => !!root && n instanceof Node && root.contains(n);

      const closeInSurface = (): boolean => {
        const s = doc.getSelection();
        if (!s || !s.rangeCount || !s.isCollapsed || !root) return false;
        const node = s.anchorNode;
        if (!node || node.nodeType !== 3 || !root.contains(node)) return false;
        const t = node as Text;
        const hit = findClosedShortcode(t.data.slice(0, s.anchorOffset), table);
        if (!hit) return false;
        const r = doc.createRange();
        r.setStart(t, hit.start);
        r.setEnd(t, s.anchorOffset);
        s.removeAllRanges();
        s.addRange(r);
        insert(hit.name);
        return true;
      };

      const closeInSource = (ta: HTMLTextAreaElement): boolean => {
        const caret = ta.selectionStart;
        const hit = findClosedShortcode(ta.value.slice(0, caret), table);
        if (!hit) return false;
        ta.setSelectionRange(hit.start, caret);
        insert(hit.name);
        return true;
      };

      const onInput = (e: Event) => {
        const ie = e as InputEvent;
        if (ie.isComposing) return;
        const t = e.target;
        if (t instanceof (win?.HTMLTextAreaElement ?? HTMLTextAreaElement) && el.contains(t)) {
          if (ie.inputType === "insertText" && ie.data === ":") closeInSource(t);
          return;
        }
        if (!inSurface(t)) return;
        if (ie.inputType === "insertText" && ie.data === ":") closeInSurface();
        ctl?.notifyInput();
      };
      // The surface inserts some characters itself (the first one in an empty block) and cancels
      // `beforeinput`, so no `input` event follows; those are handled here.
      const onBeforeInput = (e: Event) => {
        if (e.defaultPrevented && inSurface(e.target)) onInput(e);
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (ctl && inSurface(e.target)) ctl.handleKeyDown(e);
      };

      attach();
      el.addEventListener("input", onInput);
      el.addEventListener("beforeinput", onBeforeInput);
      el.addEventListener("keydown", onKeyDown, true);
      const offMode = ed.on("mode", attach);
      const offCmd = ed.registerCommand("insertShortcode", (_e, arg) => (typeof arg === "string" ? insert(arg) : false));

      return () => {
        el.removeEventListener("input", onInput);
        el.removeEventListener("beforeinput", onBeforeInput);
        el.removeEventListener("keydown", onKeyDown, true);
        offMode();
        offCmd();
        ctl?.destroy();
        ctl = null;
        root = null;
      };
    },
  });
}
