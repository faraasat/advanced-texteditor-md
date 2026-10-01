/**
 * Mention typeahead as a framework-free controller.
 *
 * Detects a trigger typed at the caret, queries the host's `search`, renders
 * an ARIA combobox/listbox menu and reports the pick. It never edits the
 * document: `onPick` receives the Range to replace.
 *
 * Server-safe at import; the DOM is only used inside `createMentionController`.
 * Everything shown comes from `textContent`/`createElement`, never innerHTML.
 */
import type { MentionItem, MentionOptions } from "../types";
import { urlAllowed } from "./upload-policy";

/* ───────────────────────────── wire format ─────────────────────────────
 *
 *   href   := scheme ":" [ kind "/" ] id [ "?" pair { "&" pair } ]
 *   pair   := key [ "=" value ]
 *
 * scheme is a letter then letters, digits, "+", "." or "-" (lower-cased on parse). kind, id, key and
 * value are each percent-encoded with encodeURIComponent plus ! ' ( ) *
 * (so the href is safe inside a markdown link destination). `kind` is
 * omitted, with its slash, when empty. On parse the id is everything after the
 * first "/" (lenient about raw slashes), and "http", "https", "mailto", "tel"
 * and other URL schemes are never chips.
 */

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export type ChipRef = { scheme: string; kind: string; id: string; attrs?: Record<string, string> };

export function mentionHref(chip: ChipRef): string {
  let href = `${chip.scheme}:${chip.kind ? enc(chip.kind) + "/" : ""}${enc(chip.id)}`;
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(chip.attrs ?? {})) {
    if (v === undefined || v === null) continue;
    pairs.push(`${enc(k)}=${enc(String(v))}`);
  }
  if (pairs.length) href += "?" + pairs.join("&");
  return href;
}

const URL_SCHEMES = new Set([
  "http", "https", "mailto", "tel", "sms", "javascript", "vbscript", "data", "file", "ftp", "blob", "ws", "wss", "about", "view-source",
]);

/** Inverse of `mentionHref`. `schemes` limits which schemes count as chips; null when the href is not one. */
export function parseMentionHref(href: string, schemes?: string[]): ChipRef | null {
  if (typeof href !== "string") return null;
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/is.exec(href);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  if (URL_SCHEMES.has(scheme)) return null;
  if (schemes && !schemes.map((s) => s.toLowerCase()).includes(scheme)) return null;
  const rest = m[2];
  if (rest.startsWith("//")) return null;
  const q = rest.indexOf("?");
  const path = q < 0 ? rest : rest.slice(0, q);
  const query = q < 0 ? "" : rest.slice(q + 1);
  try {
    const slash = path.indexOf("/");
    const kind = slash < 0 ? "" : decodeURIComponent(path.slice(0, slash));
    const id = decodeURIComponent(slash < 0 ? path : path.slice(slash + 1));
    if (!id) return null;
    const out: ChipRef = { scheme, kind, id };
    if (query) {
      const attrs: Record<string, string> = {};
      for (const part of query.split("&")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        const k = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
        if (k) attrs[k] = eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1));
      }
      if (Object.keys(attrs).length) out.attrs = attrs;
    }
    return out;
  } catch {
    return null;
  }
}

/* ───────────────────────────── detection ───────────────────────────── */

export type TriggerMatch = { trigger: string; query: string; start: number };

const MAX_QUERY = 60;
// Characters after which a trigger may start a mention: start of text, whitespace, opening/ending punctuation.
const BOUNDARY_RE = /[\s(\[{<"'`,.;:!?\-—–‘“¿¡]/;

/**
 * Is there an open mention at the end of `textBeforeCaret`? The trigger must
 * start the text or follow whitespace/punctuation, so `a@b.com` is not a
 * mention. With several triggers the one closest to the caret wins. The query
 * may not start with whitespace, contain a line break, contain another
 * trigger, or (without `allowSpaces`) contain whitespace; it is capped at 60
 * characters.
 */
export function detectTrigger(textBeforeCaret: string, triggers: string[], allowSpaces: boolean): TriggerMatch | null {
  let best: TriggerMatch | null = null;
  for (const trigger of triggers) {
    if (!trigger) continue;
    const start = textBeforeCaret.lastIndexOf(trigger);
    if (start < 0) continue;
    const before = start === 0 ? "" : textBeforeCaret[start - 1];
    if (before && !BOUNDARY_RE.test(before)) continue;
    const query = textBeforeCaret.slice(start + trigger.length);
    if (query.length > MAX_QUERY || /^\s/.test(query) || /[\n\r]/.test(query)) continue;
    if (!allowSpaces && /\s/.test(query)) continue;
    if (best === null || start > best.start) best = { trigger, query, start };
  }
  return best;
}

/* ───────────────────────────── controller ───────────────────────────── */

export type MentionLabels = {
  /** Live-region text for N results. Default "N results" / "1 result". */
  results?: (count: number) => string;
  noResults?: string;
  searching?: string;
  /** Accessible name of the list. Default "Suggestions". */
  menu?: string;
};

export type MentionControllerOptions = {
  /** The editable surface. */
  root: HTMLElement;
  options: MentionOptions[];
  document?: Document;
  labels: MentionLabels;
  onPick: (item: MentionItem, optionsIndex: number, range: Range) => void;
  /** Caret rectangle in viewport coordinates. */
  getRect: () => DOMRect;
};

export type MentionController = {
  destroy(): void;
  isOpen(): boolean;
  /** Forward editor keydowns here; true means the key was consumed. */
  handleKeyDown(ev: KeyboardEvent): boolean;
  /** Call after every input event (and after caret moves). */
  notifyInput(): void;
};

type Row = { item: MentionItem; el: HTMLElement };

let uid = 0;
const GAP = 4;
const MARGIN = 8;

function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const first = (w: string) => Array.from(w)[0] ?? "";
  if (!words.length) return "?";
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : "")).toUpperCase();
}

export function createMentionController(config: MentionControllerOptions): MentionController {
  const { root, getRect, onPick } = config;
  const doc = config.document ?? root.ownerDocument;
  const win = doc.defaultView as Window;
  const labels = config.labels ?? {};
  const optionList = config.options.map((o) => ({ ...o, trigger: o.trigger || "@" }));
    const id = `atm-mention-${++uid}`;

  const hadHaspopup = root.getAttribute("aria-haspopup");
  root.setAttribute("aria-haspopup", "listbox");
  root.setAttribute("aria-expanded", "false");

  const live = doc.createElement("div");
  live.className = "atm-mention-live";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  live.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";
  doc.body.appendChild(live);

  let menuEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let rows: Row[] = [];
  let active = -1;
  let items: MentionItem[] = [];
  let current: { optIndex: number; trigger: string; start: number; node: Text; query: string } | null = null;
  let dismissed: { node: Text; start: number } | null = null;
  let loading = false;
  let seq = 0;
  let abort: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let listening = false;

  /* ── selection helpers ── */

  function caretContext(): { node: Text; offset: number } | null {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !root.contains(node)) return null;
    return { node: node as Text, offset: sel.anchorOffset };
  }

  /* ── lifecycle ── */

  function listen(on: boolean) {
    if (on === listening) return;
    listening = on;
    const m = on ? "addEventListener" : "removeEventListener";
    win[m]("scroll", reposition, true);
    win[m]("resize", reposition);
    doc[m]("mousedown", onOutside, true);
    doc[m]("touchstart", onOutside, true);
  }

  function onOutside(ev: Event) {
    const t = ev.target as Node | null;
    if (t && (menuEl?.contains(t) || root.contains(t))) return;
    close();
  }

  function cancelPending() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    abort?.abort();
    abort = null;
    seq++;
    loading = false;
  }

  function close(keepDismissed = false) {
    if (!keepDismissed) dismissed = null;
    cancelPending();
    const wasOpen = !!menuEl;
    menuEl?.remove();
    menuEl = listEl = statusEl = null;
    rows = [];
    items = [];
    active = -1;
    current = null;
    root.setAttribute("aria-expanded", "false");
    root.removeAttribute("aria-activedescendant");
    root.removeAttribute("aria-controls");
    if (wasOpen) live.textContent = "";
    listen(false);
  }

  function ensureMenu() {
    if (menuEl) return;
    menuEl = doc.createElement("div");
    menuEl.className = "atm-mention-menu";
    menuEl.style.cssText = "position:fixed;z-index:1000;left:0;top:0;overflow:auto";
    listEl = doc.createElement("div");
    listEl.id = `${id}-list`;
    listEl.className = "atm-mention-list";
    listEl.setAttribute("role", "listbox");
    listEl.setAttribute("aria-label", labels.menu ?? "Suggestions");
    statusEl = doc.createElement("div");
    statusEl.className = "atm-mention-status";
    menuEl.append(listEl, statusEl);
    doc.body.appendChild(menuEl);
    root.setAttribute("aria-expanded", "true");
    root.setAttribute("aria-controls", listEl.id);
    listen(true);
  }

  /* ── search ── */

  const optsOf = () => optionList[current!.optIndex];

  function runSearch(immediate: boolean) {
    if (!current) return;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    abort?.abort();
    const mySeq = ++seq;
    const query = current.query;
    const opt = optsOf();
    const go = () => {
      timer = null;
      if (destroyed || mySeq !== seq || !current) return;
      const ac = new AbortController();
      abort = ac;
      let res: MentionItem[] | Promise<MentionItem[]>;
      try {
        res = opt.search(query, { signal: ac.signal });
      } catch {
        res = [];
      }
      if (res && typeof (res as Promise<MentionItem[]>).then === "function") {
        loading = true;
        render();
        (res as Promise<MentionItem[]>).then(
          (r) => settle(mySeq, ac, r),
          () => settle(mySeq, ac, null),
        );
      } else {
        settle(mySeq, ac, res as MentionItem[]);
      }
    };
    if (immediate || !(opt.debounceMs ?? 100)) go();
    else timer = setTimeout(go, opt.debounceMs ?? 100);
  }

  function settle(mySeq: number, ac: AbortController, result: MentionItem[] | null) {
    if (destroyed || mySeq !== seq || ac.signal.aborted || !current) return;
    loading = false;
    const max = optsOf().maxResults ?? 8;
    items = Array.isArray(result) ? result.slice(0, max) : [];
    const groupBy = optsOf().groupBy;
    if (groupBy) {
      const order: string[] = [];
      const key = (i: MentionItem) => groupBy(i) ?? "";
      for (const i of items) if (!order.includes(key(i))) order.push(key(i));
      items = order.flatMap((g) => items.filter((i) => key(i) === g));
    }
    active = items.length ? 0 : -1;
    if (!items.length && /\s\s$/.test(current.query)) return close();
    render();
  }

  /* ── rendering ── */

  function colorOf(c: MentionItem["color"]): string | null {
    if (typeof c === "number" && Number.isInteger(c) && c >= 1 && c <= 8) return `var(--atm-chip-${c})`;
    if (typeof c === "string" && c.trim() && !/[;{}<>\\]/.test(c)) return c.trim();
    return null;
  }

  function buildRow(item: MentionItem, index: number): HTMLElement {
    const el = doc.createElement("div");
    el.id = `${id}-opt-${index}`;
    el.className = "atm-mention-option";
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", "false");
    const color = colorOf(item.color);
    if (color) el.style.setProperty("--atm-chip-color", color);
    const custom = optsOf().renderItem?.(item);
    if (custom !== undefined && custom !== null) {
      if (typeof custom === "string") el.appendChild(doc.createTextNode(custom));
      else el.appendChild(custom);
      return el;
    }
    const avatar = doc.createElement("span");
    avatar.className = "atm-mention-avatar";
    avatar.setAttribute("aria-hidden", "true");
    if (item.avatarUrl && urlAllowed(item.avatarUrl, { allowedSchemes: ["http", "https"] }, "image")) {
      const img = doc.createElement("img");
      img.setAttribute("src", item.avatarUrl);
      img.setAttribute("alt", "");
      img.setAttribute("loading", "lazy");
      avatar.appendChild(img);
    } else {
      avatar.textContent = initials(item.label);
    }
    const body = doc.createElement("span");
    body.className = "atm-mention-body";
    const label = doc.createElement("span");
    label.className = "atm-mention-label";
    label.textContent = item.label;
    body.appendChild(label);
    if (item.description) {
      const d = doc.createElement("span");
      d.className = "atm-mention-desc";
      d.textContent = item.description;
      body.appendChild(d);
    }
    el.append(avatar, body);
    if (item.badge) {
      const b = doc.createElement("span");
      b.className = "atm-mention-badge";
      b.textContent = item.badge;
      el.appendChild(b);
    }
    return el;
  }

  function render() {
    if (destroyed || !current) return;
    const opt = optsOf();
    ensureMenu();
    const list = listEl!;
    list.textContent = "";
    rows = [];
    list.setAttribute("aria-busy", loading && !items.length ? "true" : "false");
    const groupBy = opt.groupBy;
    let group: HTMLElement | null = null;
    let lastGroup: string | undefined | null = null;
    items.forEach((item, i) => {
      if (groupBy) {
        const g = groupBy(item) ?? "";
        if (g !== lastGroup) {
          lastGroup = g;
          group = doc.createElement("div");
          group.setAttribute("role", "group");
          group.className = "atm-mention-groupbox";
          if (g) {
            const h = doc.createElement("div");
            h.id = `${id}-grp-${i}`;
            h.className = "atm-mention-group";
            h.textContent = g;
            group.setAttribute("aria-labelledby", h.id);
            group.appendChild(h);
          }
          list.appendChild(group);
        }
      }
      const el = buildRow(item, i);
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", (e) => {
        e.preventDefault();
        pick(i);
      });
      el.addEventListener("mousemove", () => {
        if (active !== i) setActive(i, false);
      });
      (group ?? list).appendChild(el);
      rows.push({ item, el });
    });

    const empty = opt.emptyText ?? labels.noResults ?? "No results";
    const statusText = loading && !items.length ? (opt.loadingText ?? labels.searching ?? "Searching...") : !loading && !items.length ? empty : "";
    statusEl!.textContent = statusText;
    statusEl!.hidden = !statusText;
    if (!loading) {
      live.textContent = items.length
        ? labels.results
          ? labels.results(items.length)
          : `${items.length} ${items.length === 1 ? "result" : "results"}`
        : empty;
    }
    setActive(active, false);
    reposition();
  }

  function setActive(i: number, scroll = true) {
    active = rows.length ? i : -1;
    rows.forEach((r, n) => r.el.setAttribute("aria-selected", n === active ? "true" : "false"));
    if (active >= 0) {
      root.setAttribute("aria-activedescendant", rows[active].el.id);
      if (scroll) rows[active].el.scrollIntoView?.({ block: "nearest" });
    } else {
      root.removeAttribute("aria-activedescendant");
    }
  }

  function reposition() {
    if (!menuEl || destroyed) return;
    let r: DOMRect;
    try {
      r = getRect();
    } catch {
      return;
    }
    const m = menuEl.getBoundingClientRect();
    const vw = win.innerWidth || doc.documentElement.clientWidth;
    const vh = win.innerHeight || doc.documentElement.clientHeight;
    const w = m.width || 240;
    const h = m.height || 0;
    const left = Math.max(MARGIN, Math.min(r.left, vw - w - MARGIN));
    const below = r.bottom + GAP;
    const flip = h > 0 && below + h > vh - MARGIN && r.top - GAP - h >= MARGIN;
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${flip ? r.top - GAP - h : below}px`;
    menuEl.style.maxHeight = `${Math.max(120, flip ? r.top - GAP - MARGIN : vh - below - MARGIN)}px`;
    menuEl.setAttribute("data-placement", flip ? "top" : "bottom");
  }

  /* ── picking ── */

  function pick(i: number) {
    if (!current || !rows[i]) return;
    const { node, start, optIndex } = current;
    const caret = caretContext();
    const end = caret && caret.node === node ? caret.offset : node.data.length;
    const range = doc.createRange();
    range.setStart(node, Math.min(start, node.data.length));
    range.setEnd(node, Math.min(end, node.data.length));
    const item = rows[i].item;
    close();
    onPick(item, optIndex, range);
  }

  /* ── input ── */

  function evaluate() {
    if (destroyed) return;
    const caret = caretContext();
    if (!caret) {
      dismissed = null;
      return close();
    }
    const before = caret.node.data.slice(0, caret.offset);
    let hit: TriggerMatch | null = null;
    let optIndex = -1;
    optionList.forEach((o, i) => {
      const h = detectTrigger(before, [o.trigger], o.allowSpaces !== false);
      if (h && (!hit || h.start > hit.start)) {
        hit = h;
        optIndex = i;
      }
    });
    if (!hit) {
      dismissed = null;
      return close();
    }
    const found: TriggerMatch = hit;
    if (dismissed && (dismissed.node !== caret.node || dismissed.start !== found.start)) dismissed = null;
    if (dismissed) return close(true);
    if (found.query.length < (optionList[optIndex].minChars ?? 0)) return close();
    if (/\s\s/.test(found.query) && !items.length && !loading) return close();

    const isNew = !current || current.node !== caret.node || current.start !== found.start || current.optIndex !== optIndex;
    const changed = isNew || current!.query !== found.query;
    current = { optIndex, trigger: found.trigger, start: found.start, node: caret.node, query: found.query };
    if (isNew) {
      items = [];
      active = -1;
      runSearch(true);
    } else if (changed) {
      runSearch(false);
    } else {
      reposition();
    }
  }

  function onSelectionChange() {
    if (menuEl || dismissed) evaluate();
  }
  doc.addEventListener("selectionchange", onSelectionChange);

  return {
    notifyInput: evaluate,
    isOpen: () => !!menuEl,
    handleKeyDown(ev) {
      if (!menuEl || destroyed || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
      const n = rows.length;
      const stop = () => {
        ev.preventDefault();
        ev.stopPropagation();
        return true;
      };
      switch (ev.key) {
        case "Escape":
          dismissed = current ? { node: current.node, start: current.start } : null;
          close(true);
          return stop();
        case "ArrowDown":
          if (!n) return false;
          setActive((active + 1) % n);
          return stop();
        case "ArrowUp":
          if (!n) return false;
          setActive((active - 1 + n) % n);
          return stop();
        case "Home":
          if (!n) return false;
          setActive(0);
          return stop();
        case "End":
          if (!n) return false;
          setActive(n - 1);
          return stop();
        case "Enter":
        case "Tab":
          if (!n || active < 0) return false;
          pick(active);
          return stop();
        default:
          return false;
      }
    },
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      doc.removeEventListener("selectionchange", onSelectionChange);
      live.remove();
      if (hadHaspopup === null) root.removeAttribute("aria-haspopup");
      else root.setAttribute("aria-haspopup", hadHaspopup);
      root.removeAttribute("aria-expanded");
    },
  };
}
