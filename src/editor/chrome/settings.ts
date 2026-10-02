/**
 * The reader's settings: density, spelling, line numbers in code, typewriter scrolling, invisible
 * characters, text size and line width. `open` shows the popover (palette: "Editor settings", or
 * `exec("settings")`); `attach` applies the stored values when the editor starts (the editor loads
 * this chunk at start only when `settings.storage` is given). Values persist through `settings.storage`
 * under `${settings.key}:settings`; without a storage they last as long as the editor.
 */
import type { EditorSettings } from "../../types";
import type { LayoutHost } from "../layouts";
import { h, uid } from "../dom";
import { labelsOf, popover, store, type DialogHandle } from "./kit";
import { typewriter } from "./typewriter";

/** English defaults of this chunk's strings (a host overrides any of them through `labels`). */
export const SETTINGS_LABELS = {
  density: "Density",
  densityCompact: "Compact",
  densityComfortable: "Comfortable",
  densitySpacious: "Spacious",
  spellcheck: "Check spelling",
  lineNumbers: "Line numbers in code",
  typewriter: "Typewriter scrolling",
  invisibles: "Show invisible characters",
  fontSize: "Text size",
  fontDefault: "Default",
  fontSmall: "Small",
  fontLarge: "Large",
  fontLarger: "Larger",
  lineWidth: "Line width",
  widthNarrow: "Narrow",
  widthNormal: "Normal",
  widthWide: "Wide",
  widthFull: "Full",
  resetSettings: "Reset",
};

export const DEFAULT_SETTINGS: EditorSettings = { density: "comfortable", spellcheck: true, lineNumbers: false, typewriter: false, invisibles: false, fontSize: "", lineWidth: "normal" };
const SIZES = ["", "14px", "18px", "20px"];
const WIDTHS: EditorSettings["lineWidth"][] = ["narrow", "normal", "wide", "full"];

type State = { s: EditorSettings; offs: (() => void)[]; pop?: DialogHandle & { place(): void } };
const states = new WeakMap<HTMLElement, State>();

/** Defaults, then the host's `settings.defaults` and `density`, then what was stored; invalid values are dropped. */
export function readSettings(host: LayoutHost): EditorSettings {
  const o = host.editor.options;
  const out: EditorSettings = { ...DEFAULT_SETTINGS, ...(o.settings ? o.settings.defaults : undefined), ...(o.density ? { density: o.density } : undefined) };
  try {
    const v = JSON.parse(store(host).get("settings") ?? "{}") as Partial<EditorSettings>;
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof EditorSettings)[]) if (typeof v[k] === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = v[k];
  } catch {
    /* a corrupt entry is ignored */
  }
  if (!["compact", "comfortable", "spacious"].includes(out.density)) out.density = "comfortable";
  if (!WIDTHS.includes(out.lineWidth)) out.lineWidth = "normal";
  if (!/^(\d{1,2}(\.\d+)?(px|rem|em))?$/.test(out.fontSize)) out.fontSize = "";
  return out;
}

function state(host: LayoutHost): State {
  let st = states.get(host.regions.root);
  if (!st) states.set(host.regions.root, (st = { s: readSettings(host), offs: [] }));
  return st;
}

/** "1\n2\n3" on each code block: style.css prints it in a gutter (no element is added to the document). */
export function numberLines(root: HTMLElement): void {
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    const n = Math.max(1, (pre.textContent ?? "").replace(/\n$/, "").split("\n").length);
    const want = Array.from({ length: n }, (_, i) => i + 1).join("\n");
    if (pre.getAttribute("data-atm-ln") !== want) pre.setAttribute("data-atm-ln", want);
  }
}

/** Spaces, tabs and non-breaking spaces as ranges, for the `::highlight()` that shows them. */
function whitespaceRanges(root: HTMLElement, max = 20000): Range[] {
  const doc = root.ownerDocument;
  const out: Range[] = [];
  const w = doc.createTreeWalker(root, 4);
  for (let n = w.nextNode() as Text | null; n && out.length < max; n = w.nextNode() as Text | null) {
    const re = /[ \t ]/g;
    for (let m = re.exec(n.data); m && out.length < max; m = re.exec(n.data)) {
      const r = doc.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + 1);
      out.push(r);
    }
  }
  return out;
}

/** Apply settings to the editor: attributes and variables on the root, spelling on the panes, and the behaviours. */
export function applySettings(host: LayoutHost, s: EditorSettings): void {
  const st = state(host);
  st.s = s;
  for (const off of st.offs.splice(0)) off();
  const { root } = host.regions;
  const win = host.doc.defaultView as (Window & typeof globalThis) | null;
  root.setAttribute("data-atm-density", s.density);
  root.setAttribute("data-atm-line-width", s.lineWidth);
  if (s.fontSize) root.style.setProperty("--atm-font-size", s.fontSize);
  else root.style.removeProperty("--atm-font-size");
  root.classList.toggle(`${host.prefix}-line-numbers`, s.lineNumbers);
  root.classList.toggle(`${host.prefix}-show-invisibles`, s.invisibles);
  const spell = () => {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[contenteditable], textarea"))) el.spellcheck = s.spellcheck;
  };
  spell();
  st.offs.push(host.editor.on("pane", spell));
  if (s.typewriter) st.offs.push(typewriter(host));
  if (s.lineNumbers || s.invisibles) {
    const name = `atm-ws-${uid("x").slice(2)}`;
    const hl = (win?.CSS as unknown as { highlights?: Map<string, unknown> })?.highlights;
    const Highlight = (win as unknown as { Highlight?: new (...r: Range[]) => unknown })?.Highlight;
    let style: HTMLStyleElement | null = null;
    if (s.invisibles && hl && Highlight) {
      style = host.doc.createElement("style");
      style.textContent = `::highlight(${name}){background-color:color-mix(in srgb,var(--atm-muted,#59636e) 22%,transparent)}`;
      root.appendChild(style);
    }
    let raf = 0;
    const draw = () => {
      raf = 0;
      if (s.lineNumbers) {
        numberLines(host.regions.surface);
        numberLines(host.regions.previewPane);
      }
      if (style && hl && Highlight) hl.set(name, new Highlight(...whitespaceRanges(host.regions.surface)));
    };
    const kick = () => {
      if (!raf && win) raf = win.requestAnimationFrame(draw);
    };
    draw();
    // Code blocks are redrawn by the surface after edits: number them again on every change.
    const mo = win && typeof win.MutationObserver === "function" ? new win.MutationObserver(kick) : null;
    mo?.observe(host.regions.surface.parentElement ?? root, { childList: true, subtree: true, characterData: true });
    st.offs.push(() => {
      mo?.disconnect();
      if (raf) win?.cancelAnimationFrame(raf);
      hl?.delete(name);
      style?.remove();
      for (const pre of Array.from(root.querySelectorAll("pre[data-atm-ln]"))) pre.removeAttribute("data-atm-ln");
    });
  }
}

/** Save and apply. */
export function setSettings(host: LayoutHost, patch: Partial<EditorSettings>): EditorSettings {
  const s = { ...state(host).s, ...patch };
  store(host).set("settings", JSON.stringify(s));
  applySettings(host, s);
  host.editor.emit("settings:change", s);
  return s;
}

export function attach(host: LayoutHost): () => void {
  applySettings(host, state(host).s);
  return () => {
    const st = states.get(host.regions.root);
    for (const off of st?.offs.splice(0) ?? []) off();
    st?.pop?.close(false);
  };
}

export function open(host: LayoutHost, _kind: string, arg?: unknown): void {
  const st = state(host);
  if (st.pop) return st.pop.close(true);
  const { doc, prefix: p } = host;
  const L = labelsOf(host, SETTINGS_LABELS);
  const anchor = arg instanceof Element ? arg : (host.regions.toolbar ?? host.regions.root).querySelector('[data-id="settings"]') ?? null;
  const r = host.regions.root.getBoundingClientRect();
  const corner = { left: Math.max(8, r.right - 320), right: r.right, top: r.top, bottom: r.top + 40, width: 0, height: 40 } as DOMRect;
  const pop = popover(host, { title: L.settings, cls: `${p}-settings`, anchor: anchor ?? corner, onClose: () => (st.pop = undefined) });
  st.pop = pop;
  const s = st.s;
  const form = h("form", { document: doc, class: `${p}-form ${p}-settings-form` });
  form.addEventListener("submit", (e) => e.preventDefault());

  // Density: a radio group drawn as a segmented control.
  const dens = h("fieldset", { document: doc, class: `${p}-segmented` }, h("legend", { document: doc, class: `${p}-label` }, L.density));
  const dn = uid(`${p}-dens`);
  for (const [v, label] of [["compact", L.densityCompact], ["comfortable", L.densityComfortable], ["spacious", L.densitySpacious]] as const) {
    const input = h("input", { document: doc, type: "radio", name: dn, value: v, checked: s.density === v }) as HTMLInputElement;
    input.addEventListener("change", () => input.checked && setSettings(host, { density: v }));
    dens.appendChild(h("label", { document: doc, class: `${p}-segment` }, input, h("span", { document: doc }, label)));
  }
  const select = (label: string, values: [string, string][], cur: string, set: (v: string) => void) => {
    const id = uid(`${p}-set`);
    const sel = h("select", { document: doc, id }) as HTMLSelectElement;
    for (const [v, t] of values) sel.appendChild(h("option", { document: doc, value: v, selected: v === cur }, t));
    sel.addEventListener("change", () => set(sel.value));
    return h("div", { document: doc, class: `${p}-field` }, h("label", { document: doc, for: id, class: `${p}-label` }, label), sel);
  };
  const check = (label: string, cur: boolean, set: (v: boolean) => void) => {
    const input = h("input", { document: doc, type: "checkbox", checked: cur }) as HTMLInputElement;
    input.addEventListener("change", () => set(input.checked));
    return h("label", { document: doc, class: `${p}-check` }, input, label);
  };
  const row = h(
    "div",
    { document: doc, class: `${p}-settings-row` },
    select(L.fontSize, [[SIZES[0], L.fontDefault], [SIZES[1], L.fontSmall], [SIZES[2], L.fontLarge], [SIZES[3], L.fontLarger]], SIZES.includes(s.fontSize) ? s.fontSize : "", (v) => setSettings(host, { fontSize: v })),
    select(L.lineWidth, [["narrow", L.widthNarrow], ["normal", L.widthNormal], ["wide", L.widthWide], ["full", L.widthFull]], s.lineWidth, (v) => setSettings(host, { lineWidth: v as EditorSettings["lineWidth"] })),
  );
  const reset = h("button", { document: doc, type: "button", class: `${p}-btn-secondary` }, L.resetSettings);
  reset.addEventListener("click", () => {
    setSettings(host, { ...DEFAULT_SETTINGS, ...(host.editor.options.settings ? host.editor.options.settings.defaults : undefined), ...(host.editor.options.density ? { density: host.editor.options.density } : undefined) });
    pop.close(false);
    open(host, "settings", arg);
  });
  form.append(
    dens,
    row,
    check(L.spellcheck, s.spellcheck, (v) => setSettings(host, { spellcheck: v })),
    check(L.lineNumbers, s.lineNumbers, (v) => setSettings(host, { lineNumbers: v })),
    check(L.typewriter, s.typewriter, (v) => setSettings(host, { typewriter: v })),
    check(L.invisibles, s.invisibles, (v) => setSettings(host, { invisibles: v })),
    h("div", { document: doc, class: `${p}-actions` }, reset),
  );
  pop.body.appendChild(form);
  pop.place();
  (form.querySelector<HTMLInputElement>("input:checked") ?? form.querySelector<HTMLElement>("input,select"))?.focus();
}
