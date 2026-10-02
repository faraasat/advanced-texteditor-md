/**
 * Status bar v2: reading time, selection stats, the cursor's line and column (Markdown mode), a save
 * status slot, zoom, and a text-direction toggle, in the order `statusBar.items` gives (the built-in
 * words, characters, counter, upload and mode items are kept and reordered; unlisted ones hide).
 * A lazy chunk: loaded when `statusBar.items` is given, or by the layouts that use a richer bar
 * (ribbon, sidebar, focus).
 *
 * The save slot shows what the host sets with `editor.exec("setSaveStatus", "Saved")` (a string, or
 * `{ state: "saved" | "saving" | "unsaved", text? }`); `""` empties it.
 */
import type { StatusBarItem } from "../../types";
import type { LayoutHost } from "../layouts";
import { h } from "../dom";
import { fmt, iconOf, labelsOf, store, textStats } from "./kit";

/** English defaults of this chunk's strings (a host overrides any of them through `labels`). */
export const STATUS_LABELS = {
  selectionStats: "{words} selected",
  cursorPos: "Ln {line}, Col {col}",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  zoomLevel: "Zoom {n}%",
  directionLtr: "Left to right",
  directionRtl: "Right to left",
  directionToggle: "Text direction",
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
};

/** Line and column (1-based) of `offset` in `text`. Pure. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const nl = before.lastIndexOf("\n");
  return { line: before.split("\n").length, col: before.length - nl };
}

export const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];

export function attach(host: LayoutHost, preset?: StatusBarItem[]): () => void {
  const bar = host.regions.statusBar;
  const items = host.statusItems ?? preset;
  if (!bar || !items) return () => undefined;
  const { doc, prefix: p, editor: ed } = host;
  const L = labelsOf(host, STATUS_LABELS);
  const wpm = ed.options.statusBar?.wordsPerMinute ?? 230;
  const offs: (() => void)[] = [];
  const made: HTMLElement[] = [];
  const mk = (cls: string, attrs: Record<string, string> = {}) => {
    const el = h("span", { document: doc, class: `${p}-status-${cls}`, ...attrs });
    made.push(el);
    return el;
  };
  const reading = mk("reading", { title: L.readingTimeLabel });
  const selection = mk("selection");
  const cursor = mk("cursor");
  const save = mk("save", { role: "status", "aria-live": "polite" });
  // Zoom: a small group of two buttons around the level.
  const zoom = mk("zoom", { role: "group", "aria-label": fmt(L.zoomLevel, { n: 100 }) });
  const zLabel = h("span", { document: doc, class: `${p}-status-zoom-level`, "aria-hidden": "true" });
  const zBtn = (dir: -1 | 1) => {
    const b = h("button", { document: doc, type: "button", class: `${p}-status-btn`, "aria-label": dir < 0 ? L.zoomOut : L.zoomIn }, iconOf(host, dir < 0 ? "zoomOut" : "zoomIn"));
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(level) + dir))]));
    return b;
  };
  zoom.append(zBtn(-1), zLabel, zBtn(1));
  const s = store(host);
  let level = Number(s.get("zoom")) || 100;
  if (!ZOOM_STEPS.includes(level)) level = 100;
  const setZoom = (n: number) => {
    level = n;
    s.set("zoom", String(n));
    host.regions.root.style.setProperty("--atm-zoom", String(n / 100));
    zLabel.textContent = `${n}%`;
    zoom.setAttribute("aria-label", fmt(L.zoomLevel, { n }));
    host.announce(fmt(L.zoomLevel, { n }));
  };
  const dirBtn = h("button", { document: doc, type: "button", class: `${p}-status-btn ${p}-status-direction`, "aria-label": L.directionToggle, "aria-pressed": "false" });
  made.push(dirBtn);
  dirBtn.addEventListener("mousedown", (e) => e.preventDefault());
  const paintDir = () => {
    const rtl = (host.regions.root.getAttribute("dir") ?? host.doc.defaultView?.getComputedStyle(host.regions.root).direction) === "rtl";
    dirBtn.textContent = rtl ? "RTL" : "LTR";
    dirBtn.setAttribute("aria-pressed", String(rtl));
    dirBtn.title = rtl ? L.directionRtl : L.directionLtr;
  };
  dirBtn.addEventListener("click", () => {
    const rtl = dirBtn.getAttribute("aria-pressed") !== "true";
    host.regions.root.setAttribute("dir", rtl ? "rtl" : "ltr");
    paintDir();
    host.toolbar()?.relayout();
  });

  const own: Partial<Record<StatusBarItem, HTMLElement | null>> = {
    words: bar.querySelector<HTMLElement>(`.${p}-status-words`),
    characters: bar.querySelector<HTMLElement>(`.${p}-status-chars`),
    count: bar.querySelector<HTMLElement>(`.${p}-status-count`),
    upload: bar.querySelector<HTMLElement>(`.${p}-status-upload`),
    mode: bar.querySelector<HTMLElement>(`.${p}-status-mode`),
    modeSwitch: bar.querySelector<HTMLElement>(`.${p}-mode-switch`),
    readingTime: reading,
    selection,
    cursor,
    save,
    zoom,
    direction: dirBtn,
  };
  // The listed items, in order; the built-in ones not listed are hidden (they keep updating).
  for (const [k, el] of Object.entries(own)) if (el && !items.includes(k as StatusBarItem)) el.classList.add(`${p}-status-off`);
  for (const k of items) {
    const el = own[k];
    if (el) bar.appendChild(el);
  }
  // Everything after the first "push right" item sits at the end of the bar.
  const right = items.find((k) => ["save", "zoom", "direction", "mode"].includes(k));
  if (right) own[right]?.classList.add(`${p}-status-push`);

  const update = () => {
    const text = ed.getText();
    const st = textStats(text, wpm);
    reading.textContent = st.words ? fmt(L.readingTime, { n: st.minutes }) : "";
    const selText = ed.getSelectionText();
    const sw = selText.trim() ? selText.trim().split(/\s+/).length : 0;
    selection.textContent = sw ? fmt(L.selectionStats, { words: `${sw} ${sw === 1 ? host.ctx.labels.words1 : host.ctx.labels.words}` }) : "";
    selection.hidden = !sw;
    const ta = ed.getMode() !== "wysiwyg" ? host.regions.markdownPane.querySelector("textarea") : null;
    if (ta) {
      const lc = lineCol(ta.value, ta.selectionStart ?? 0);
      cursor.textContent = fmt(L.cursorPos, lc);
    }
    cursor.hidden = !ta;
  };
  offs.push(ed.on("change", update), ed.on("selection", update), ed.on("mode", update), host.onUpdate(update));
  // The textarea reports caret moves through keyup and clicks, not the editor's selection event.
  const onKey = () => ed.getMode() !== "wysiwyg" && update();
  host.regions.markdownPane.addEventListener("keyup", onKey);
  host.regions.markdownPane.addEventListener("click", onKey);
  offs.push(() => {
    host.regions.markdownPane.removeEventListener("keyup", onKey);
    host.regions.markdownPane.removeEventListener("click", onKey);
  });
  // The save slot: the host sets it (a string, or { state, text }).
  offs.push(
    ed.registerCommand("setSaveStatus", (_e, arg) => {
      const a = arg as string | { state?: string; text?: string } | undefined;
      const state = typeof a === "object" && a ? a.state ?? "" : "";
      const text = typeof a === "string" ? a : (a?.text ?? (state ? (L as Record<string, string>)[state] ?? state : ""));
      save.textContent = text;
      save.setAttribute("data-state", state);
      save.hidden = !text;
      return true;
    }),
  );
  save.hidden = true;
  if (level !== 100) setZoom(level);
  else zLabel.textContent = "100%";
  paintDir();
  update();
  return () => {
    for (const off of offs) off();
    for (const el of made) el.remove();
    for (const el of Object.values(own)) el?.classList.remove(`${p}-status-off`, `${p}-status-push`);
    host.regions.root.style.removeProperty("--atm-zoom");
  };
}
