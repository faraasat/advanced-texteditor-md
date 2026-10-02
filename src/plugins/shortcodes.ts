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
 * the trigger `:` and `hideWhenEmpty`. It listens through the editor's plugin hooks
 * (`afterInput`, `keydown`) and its `pane` event, not through DOM listeners.
 */

export type ShortcodesLabels = {
  /** Accessible name of the list. Default "Shortcodes". */
  menu: string;
  /**
   * No longer shown: the menu stays closed while nothing matches (`hideWhenEmpty`), so a `:` that
   * is just punctuation never flashes a "no results" row. Kept so existing configurations compile.
   */
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

type Instance = {
  afterInput(info?: { inputType: string; data: string | null }): void;
  keydown(ev: KeyboardEvent): boolean;
};

/** See the file header. Command: `insertShortcode`. */
export function createShortcodesPlugin(options: ShortcodesOptions): Plugin {
  const table = clean(options.shortcodes);
  const labels: ShortcodesLabels = { menu: "Shortcodes", noResults: "No matching shortcode", ...options.labels };
  const minChars = options.minChars ?? 2;
  const maxResults = options.maxResults ?? 8;
  const maxRecent = options.maxRecent ?? 20;
  const recentKey = options.recentKey ?? "atm-shortcodes-recent";
  // The hooks of one plugin object serve every editor it is installed in.
  const instances = new WeakMap<EditorInstance, Instance>();

  return definePlugin({
    name: "shortcodes",
    commands: {},
    css: SHORTCODES_CSS,
    afterInput: (ed, info) => instances.get(ed)?.afterInput(info),
    keydown: (ev, ed) => instances.get(ed)?.keydown(ev) ?? false,
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

      const attach = () => {
        const s = ed.getMode() === "wysiwyg" ? el.querySelector<HTMLElement>(".atm-surface") : null;
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
              hideWhenEmpty: true,
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

      instances.set(ed, {
        afterInput(info) {
          if (info?.inputType === "insertCompositionText") return;
          const pane = ed.getPane();
          const field = pane?.el;
          if (ed.getMode() !== "wysiwyg") {
            const ta = field instanceof (win?.HTMLTextAreaElement ?? HTMLTextAreaElement) ? field : null;
            if (ta && info?.inputType === "insertText" && info.data === ":") closeInSource(ta);
            return;
          }
          if (info?.inputType === "insertText" && info.data === ":") closeInSurface();
          ctl?.notifyInput();
        },
        keydown: (ev) => !!ctl && !ev.isComposing && ctl.handleKeyDown(ev),
      });

      attach();
      const offPane = ed.on("pane", attach);
      const offCmd = ed.registerCommand("insertShortcode", (_e, arg) => (typeof arg === "string" ? insert(arg) : false));

      return () => {
        instances.delete(ed);
        offPane();
        offCmd();
        ctl?.destroy();
        ctl = null;
        root = null;
      };
    },
  });
}
