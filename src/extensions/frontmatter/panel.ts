/**
 * The properties panel: the DOM for one front-matter block, editable (inside the editor, in a
 * shadow root) or read-only (views, and the editor while it is read-only). Every string reaches the
 * page as a text node or an attribute value; the only markup is the constant icons below.
 *
 * Server-safe at import.
 */
import { h } from "../_shared";
import { isIsoDate, type YamlEntry, type YamlList, type YamlMap, type YamlScalar, type YamlSubset, type YamlValue } from "./yaml";

export type FrontMatterLabels = {
  /** The panel's title (the collapse button). */
  title: string;
  /** Shown beside the title: `{n}` is the number of properties. */
  count: string;
  addProperty: string;
  /** Accessible name of a property name field. */
  name: string;
  /** Accessible name of the type picker of a new property. */
  type: string;
  add: string;
  cancel: string;
  /** `{key}` is the property. */
  remove: string;
  /** `{key}` is the property. */
  addItem: string;
  /** `{item}` is the item. */
  removeItem: string;
  /** Beside a property the panel cannot edit: its text is kept exactly as written. */
  keptAsWritten: string;
  /** The key cell of a line that is not a `key:` line. */
  other: string;
  /** Instead of the rows when the block is over the size limits. */
  tooLarge: string;
  /** No properties yet. */
  empty: string;
  text: string;
  number: string;
  date: string;
  checkbox: string;
  list: string;
  yes: string;
  no: string;
  /** An empty value in a read-only view. */
  none: string;
  emptyName: string;
  /** `{key}` is the name that is taken. */
  duplicateName: string;
  /** Announced. `{key}`. */
  removed: string;
  /** Announced. `{key}`. */
  added: string;
};

export const FRONT_MATTER_LABELS: FrontMatterLabels = {
  title: "Properties",
  count: "{n}",
  addProperty: "Add property",
  name: "Property name",
  type: "Type",
  add: "Add",
  cancel: "Cancel",
  remove: "Remove {key}",
  addItem: "Add to {key}",
  removeItem: "Remove {item}",
  keptAsWritten: "Kept as written",
  other: "Other",
  tooLarge: "Too large to edit here. Kept as written.",
  empty: "No properties",
  text: "Text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
  list: "List",
  yes: "Yes",
  no: "No",
  none: "(empty)",
  emptyName: "Enter a name.",
  duplicateName: "A property named {key} already exists.",
  removed: "{key} removed",
  added: "{key} added",
};

export type NewKind = "text" | "number" | "date" | "checkbox" | "list";

export type PanelHandlers = {
  /**
   * Set a property's value. `focus` (a focus id) is given when the change redraws the panel (lists):
   * the element to focus afterwards. Scalar edits keep the panel as it is.
   */
  set(key: string, value: YamlValue, focus?: string): void;
  /** Rename; returns an error message, or null when done. */
  rename(from: string, to: string): string | null;
  remove(key: string): void;
  /** Add a property; returns an error message, or null when done. */
  add(key: string, value: YamlValue): string | null;
  toggle(collapsed: boolean): void;
  /** Escape: back to the document. */
  leave(): void;
};

export type PanelOptions = {
  labels: FrontMatterLabels;
  collapsed: boolean;
  /** Unique prefix for element ids. */
  uid: string;
  /** Today's date for a new date property. */
  today?: () => Date;
  /** A live region that outlives a redraw of the panel (announcements). */
  status?: HTMLElement;
};

const fmt = (s: string, v: Record<string, string | number>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

const ICON_CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_X = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function icon(doc: Document, svg: string, cls: string): HTMLElement {
  const s = doc.createElement("span");
  s.className = cls;
  s.setAttribute("aria-hidden", "true");
  // Constant markup only; never a user string.
  s.innerHTML = svg;
  return s;
}

/** Scalar as the text a field shows. */
export function scalarLabel(v: YamlScalar | undefined, text?: string): string {
  if (text !== undefined) return text;
  if (v === null || v === undefined) return "";
  return String(v);
}

/** The value a text field's text means for a property that was of `kind`. */
export function valueFromText(text: string, kind: YamlEntry["kind"]): YamlScalar {
  const t = text;
  if (kind === "number" && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(t.trim()) && Number.isFinite(Number(t))) return Number(t);
  if (kind === "null" && t === "") return null;
  if (kind === "date" && t === "") return null;
  return t;
}

function todayIso(today?: () => Date): string {
  const d = today ? today() : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const focusId = (el: HTMLElement, id: string) => el.setAttribute("data-fm-focus", id);

/* ───────────────────────────── read-only ───────────────────────────── */

function viewValue(doc: Document, v: YamlValue | undefined, kind: YamlEntry["kind"], L: FrontMatterLabels, text?: string): HTMLElement | Text {
  if (Array.isArray(v)) {
    if (!v.length) return doc.createTextNode(L.none);
    return h(doc, "ul", { class: "atm-fm-chips" }, ...v.map((x) => h(doc, "li", { class: "atm-fm-chip" }, scalarLabel(x) || L.none)));
  }
  if (v && typeof v === "object") {
    const m = v as YamlMap;
    return h(doc, "dl", { class: "atm-fm-map" }, ...Object.keys(m).map((k) => h(doc, "div", { class: "atm-fm-sub" }, h(doc, "dt", {}, k), h(doc, "dd", {}, viewValue(doc, m[k], "string", L)))));
  }
  if (kind === "date" && typeof v === "string") return h(doc, "time", { class: "atm-fm-chip atm-fm-date", datetime: v }, v);
  if (typeof v === "boolean") return h(doc, "span", { class: "atm-fm-chip atm-fm-bool", "data-value": String(v) }, v ? L.yes : L.no);
  const s = scalarLabel(v as YamlScalar, text);
  return s === "" ? h(doc, "span", { class: "atm-fm-none" }, L.none) : doc.createTextNode(s);
}

function rawBlock(doc: Document, raw: string, L: FrontMatterLabels): HTMLElement[] {
  return [h(doc, "pre", { class: "atm-fm-raw" }, h(doc, "code", {}, raw)), h(doc, "span", { class: "atm-fm-note" }, L.keptAsWritten)];
}

function header(doc: Document, sub: YamlSubset, o: PanelOptions, body: HTMLElement, onToggle: (c: boolean) => void): HTMLElement {
  const L = o.labels;
  const titleId = o.uid + "-title";
  const btn = h(
    doc,
    "button",
    { type: "button", class: "atm-fm-toggle", "aria-expanded": String(!o.collapsed), "aria-controls": body.id, part: "toggle" },
    icon(doc, ICON_CHEVRON, "atm-fm-chevron"),
    h(doc, "span", { class: "atm-fm-title", id: titleId }, L.title),
    h(doc, "span", { class: "atm-fm-count" }, fmt(L.count, { n: sub.entries.length })),
  );
  focusId(btn, "toggle");
  btn.addEventListener("click", () => {
    const collapsed = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!collapsed));
    body.hidden = collapsed;
    onToggle(collapsed);
  });
  return btn;
}

/** The read-only panel: a definition list of the properties. */
export function buildViewPanel(doc: Document, sub: YamlSubset, o: PanelOptions, onToggle: (c: boolean) => void = () => {}): HTMLElement {
  const L = o.labels;
  const body = h(doc, "div", { class: "atm-fm-body", id: o.uid + "-body" });
  body.hidden = o.collapsed;
  if (sub.tooLarge) body.append(h(doc, "p", { class: "atm-fm-note" }, L.tooLarge));
  else if (!sub.entries.length) body.append(h(doc, "p", { class: "atm-fm-empty" }, L.empty));
  else {
    const dl = h(doc, "dl", { class: "atm-fm-list" });
    for (const e of sub.entries) {
      const dd = h(doc, "dd", { class: "atm-fm-value" });
      if (e.readonly && e.value === undefined) dd.append(...rawBlock(doc, e.raw, L));
      else dd.append(viewValue(doc, e.value, e.kind, L, e.text));
      dl.append(h(doc, "div", { class: "atm-fm-row" + (e.readonly ? " atm-fm-readonly" : "") }, h(doc, "dt", { class: "atm-fm-key" }, e.key || L.other), dd));
    }
    body.append(dl);
  }
  const root = h(doc, "div", { class: "atm-fm atm-fm-view", role: "group", "aria-labelledby": o.uid + "-title", part: "panel" });
  root.append(header(doc, sub, o, body, onToggle), body);
  return root;
}

/* ───────────────────────────── editable ───────────────────────────── */

type Row = { key: string; entry: YamlEntry; el: HTMLElement; relabel(): void };

/** The editable panel. Text fields commit on change (blur) and Enter; the rest at once. */
export function buildEditPanel(doc: Document, sub: YamlSubset, o: PanelOptions, act: PanelHandlers): HTMLElement {
  const L = o.labels;
  const body = h(doc, "div", { class: "atm-fm-body", id: o.uid + "-body" });
  body.hidden = o.collapsed;
  const status = o.status ?? h(doc, "p", { class: "atm-fm-status", role: "status", "aria-live": "polite" });
  const root = h(doc, "div", { class: "atm-fm", role: "group", "aria-labelledby": o.uid + "-title", part: "panel" });
  root.append(header(doc, sub, o, body, act.toggle), body);
  if (!o.status) root.append(status);
  const say = (s: string) => {
    status.textContent = "";
    status.textContent = s;
  };

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      act.leave();
    }
  });

  if (sub.tooLarge) {
    body.append(h(doc, "p", { class: "atm-fm-note" }, L.tooLarge));
    return root;
  }

  const rows = h(doc, "div", { class: "atm-fm-rows" });
  body.append(rows);
  if (!sub.entries.length) rows.append(h(doc, "p", { class: "atm-fm-empty" }, L.empty));
  let n = 0;
  for (const e of sub.entries) rows.append(row(e, n++).el);

  function row(entry: YamlEntry, i: number): Row {
    const r: Row = { key: entry.key, entry, el: h(doc, "div", { class: "atm-fm-row" + (entry.readonly ? " atm-fm-readonly" : ""), part: "row" }), relabel: () => {} };
    const fid = o.uid + "-v" + i;
    let keyCell: HTMLElement;
    const editableKey = !entry.readonly && entry.key !== "";
    if (editableKey) {
      const ki = h(doc, "input", { type: "text", class: "atm-fm-key", "aria-label": L.name, spellcheck: "false", autocomplete: "off" });
      ki.value = entry.key;
      focusId(ki, "key:" + entry.key);
      const commit = () => {
        const to = ki.value;
        if (to === r.key) return;
        const err = to.trim() === "" ? L.emptyName : act.rename(r.key, to);
        if (err) {
          ki.setAttribute("aria-invalid", "true");
          say(err);
          ki.value = r.key;
          return;
        }
        ki.removeAttribute("aria-invalid");
        r.key = to;
        r.relabel();
      };
      ki.addEventListener("change", commit);
      ki.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.isComposing) {
          ev.preventDefault();
          commit();
        }
      });
      keyCell = ki;
    } else keyCell = h(doc, "span", { class: "atm-fm-key atm-fm-key-text" }, entry.key || L.other);
    const value = h(doc, "div", { class: "atm-fm-value" });
    const labelled: { el: HTMLElement; attr: string; tpl?: string }[] = [];
    if (entry.readonly) value.append(...rawBlock(doc, entry.raw, L));
    else value.append(editor(entry, r, fid, labelled));
    r.el.append(keyCell, value);
    if (entry.key !== "" || entry.readonly) {
      const rm = h(doc, "button", { type: "button", class: "atm-fm-remove", "aria-label": fmt(L.remove, { key: entry.key || L.other }) }, icon(doc, ICON_X, "atm-fm-icon"));
      focusId(rm, "remove:" + entry.key);
      rm.addEventListener("click", () => {
        act.remove(r.key);
      });
      r.el.append(rm);
      labelled.push({ el: rm, attr: "aria-label", tpl: L.remove });
    }
    r.relabel = () => {
      for (const x of labelled) x.el.setAttribute(x.attr, x.tpl ? fmt(x.tpl, { key: r.key }) : r.key);
      r.el.querySelectorAll<HTMLElement>("[data-fm-focus]").forEach((el) => {
        const id = el.getAttribute("data-fm-focus")!;
        const c = id.indexOf(":");
        if (c > 0 && !id.startsWith("chip:")) el.setAttribute("data-fm-focus", id.slice(0, c + 1) + r.key);
      });
    };
    return r;
  }

  function editor(entry: YamlEntry, r: Row, fid: string, labelled: { el: HTMLElement; attr: string; tpl?: string }[]): HTMLElement {
    const v = entry.value;
    if (entry.kind === "boolean") {
      const cb = h(doc, "input", { type: "checkbox", role: "switch", class: "atm-fm-switch-input", id: fid, "aria-label": entry.key });
      cb.checked = v === true;
      focusId(cb, "value:" + entry.key);
      labelled.push({ el: cb, attr: "aria-label" });
      const txt = h(doc, "span", { class: "atm-fm-switch-text", "aria-hidden": "true" }, cb.checked ? L.yes : L.no);
      cb.addEventListener("change", () => {
        txt.textContent = cb.checked ? L.yes : L.no;
        act.set(r.key, cb.checked);
      });
      return h(doc, "label", { class: "atm-fm-switch" }, cb, h(doc, "span", { class: "atm-fm-track", "aria-hidden": "true" }), txt);
    }
    if (entry.kind === "date") {
      const di = h(doc, "input", { type: "date", class: "atm-fm-input atm-fm-date", id: fid, "aria-label": entry.key });
      di.value = typeof v === "string" ? v : "";
      focusId(di, "value:" + entry.key);
      labelled.push({ el: di, attr: "aria-label" });
      di.addEventListener("change", () => {
        const t = di.value;
        if (t !== "" && !isIsoDate(t)) return;
        act.set(r.key, t === "" ? null : t);
      });
      return di;
    }
    if (entry.kind === "list") return chips(v as YamlList, r, labelled);
    if (entry.kind === "map") {
      const m = v as YamlMap;
      const box = h(doc, "div", { class: "atm-fm-map" });
      let k = 0;
      for (const sk of Object.keys(m)) {
        const sv = m[sk];
        const id = fid + "-" + k++;
        if (Array.isArray(sv)) {
          box.append(h(doc, "div", { class: "atm-fm-sub" }, h(doc, "span", { class: "atm-fm-subkey" }, sk), h(doc, "span", { class: "atm-fm-subtext" }, "[" + sv.map((x) => scalarLabel(x)).join(", ") + "]")));
          continue;
        }
        const inp = h(doc, "input", { type: "text", class: "atm-fm-input", id, spellcheck: "false" });
        inp.value = scalarLabel(sv);
        focusId(inp, "sub:" + entry.key + ":" + sk);
        const kind = typeof sv === "number" ? "number" : sv === null ? "null" : "string";
        const commit = () => {
          const cur = (entry.value as YamlMap)[sk];
          const nv = typeof cur === "boolean" && /^(?:true|false)$/.test(inp.value) ? inp.value === "true" : valueFromText(inp.value, kind);
          if (nv === cur) return;
          const next: YamlMap = Object.create(null);
          for (const x of Object.keys(entry.value as YamlMap)) next[x] = (entry.value as YamlMap)[x];
          next[sk] = nv;
          entry.value = next;
          act.set(r.key, next);
        };
        inp.addEventListener("change", commit);
        inp.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" && !ev.isComposing) {
            ev.preventDefault();
            commit();
          }
        });
        box.append(h(doc, "div", { class: "atm-fm-sub" }, h(doc, "label", { class: "atm-fm-subkey", for: id }, sk), inp));
      }
      return box;
    }
    const ti = h(doc, "input", { type: "text", class: "atm-fm-input", id: fid, "aria-label": entry.key, spellcheck: "false" });
    ti.value = scalarLabel(v as YamlScalar, entry.text);
    if (entry.kind === "number") ti.setAttribute("inputmode", "decimal");
    focusId(ti, "value:" + entry.key);
    labelled.push({ el: ti, attr: "aria-label" });
    let shown = ti.value;
    const commit = () => {
      if (ti.value === shown) return;
      shown = ti.value;
      act.set(r.key, valueFromText(ti.value, entry.kind));
    };
    ti.addEventListener("change", commit);
    ti.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing) {
        ev.preventDefault();
        commit();
      }
    });
    return ti;
  }

  function chips(list: YamlList, r: Row, labelled: { el: HTMLElement; attr: string; tpl?: string }[]): HTMLElement {
    const items = list.slice();
    const ul = h(doc, "ul", { class: "atm-fm-chips", "aria-label": r.key });
    labelled.push({ el: ul, attr: "aria-label" });
    items.forEach((it, i) => {
      const label = scalarLabel(it) || "null";
      const x = h(doc, "button", { type: "button", class: "atm-fm-chip-x", "aria-label": fmt(L.removeItem, { item: label }) }, icon(doc, ICON_X, "atm-fm-icon"));
      focusId(x, `chip:${r.key}:${i}`);
      x.addEventListener("click", () => {
        const next = items.filter((_, j) => j !== i);
        act.set(r.key, next, next.length ? `chip:${r.key}:${Math.min(i, next.length - 1)}` : "chip-input:" + r.key);
      });
      ul.append(h(doc, "li", { class: "atm-fm-chip" }, h(doc, "span", { class: "atm-fm-chip-text" }, label), x));
    });
    const inp = h(doc, "input", { type: "text", class: "atm-fm-chip-input", "aria-label": fmt(L.addItem, { key: r.key }), spellcheck: "false", autocomplete: "off", enterkeyhint: "enter" });
    focusId(inp, "chip-input:" + r.key);
    labelled.push({ el: inp, attr: "aria-label", tpl: L.addItem });
    const numeric = items.length > 0 && items.every((x) => typeof x === "number");
    const addText = (t: string) => {
      const s = t.trim();
      if (!s) return;
      const val: YamlScalar = numeric && /^[-+]?\d+(?:\.\d+)?$/.test(s) ? Number(s) : s;
      act.set(r.key, [...items, val], "chip-input:" + r.key);
    };
    inp.addEventListener("keydown", (ev) => {
      if (ev.isComposing) return;
      if (ev.key === "Enter" || ev.key === ",") {
        ev.preventDefault();
        addText(inp.value);
      } else if (ev.key === "Backspace" && inp.value === "" && items.length) {
        ev.preventDefault();
        const xs = ul.querySelectorAll<HTMLButtonElement>(".atm-fm-chip-x");
        xs[xs.length - 1]?.focus();
      }
    });
    inp.addEventListener("change", () => addText(inp.value));
    return h(doc, "div", { class: "atm-fm-chipbox" }, ul, inp);
  }

  // Add a property.
  const addBox = h(doc, "div", { class: "atm-fm-add" });
  const addBtn = h(doc, "button", { type: "button", class: "atm-fm-add-btn" }, icon(doc, ICON_PLUS, "atm-fm-icon"), L.addProperty);
  focusId(addBtn, "add");
  addBox.append(addBtn);
  body.append(addBox);
  addBtn.addEventListener("click", () => openForm());

  function openForm(): void {
    const errId = o.uid + "-err";
    const name = h(doc, "input", { type: "text", class: "atm-fm-input atm-fm-new-name", "aria-label": L.name, spellcheck: "false", autocomplete: "off" });
    focusId(name, "new-name");
    const type = h(doc, "select", { class: "atm-fm-input atm-fm-new-type", "aria-label": L.type });
    for (const k of ["text", "number", "date", "checkbox", "list"] as NewKind[]) type.append(h(doc, "option", { value: k }, L[k]));
    const err = h(doc, "p", { class: "atm-fm-error", id: errId });
    const ok = h(doc, "button", { type: "button", class: "atm-fm-btn atm-fm-btn-primary" }, L.add);
    const cancel = h(doc, "button", { type: "button", class: "atm-fm-btn" }, L.cancel);
    const form = h(doc, "div", { class: "atm-fm-new", role: "group", "aria-label": L.addProperty }, name, type, ok, cancel, err);
    const close = () => {
      form.replaceWith(addBox);
      addBtn.focus();
    };
    const submit = () => {
      const key = name.value;
      const kind = type.value as NewKind;
      const value: YamlValue = kind === "number" ? 0 : kind === "date" ? todayIso(o.today) : kind === "checkbox" ? false : kind === "list" ? [] : "";
      const e = key.trim() === "" ? L.emptyName : act.add(key, value);
      if (e) {
        err.textContent = e;
        name.setAttribute("aria-invalid", "true");
        name.setAttribute("aria-describedby", errId);
        name.focus();
        return;
      }
      say(fmt(L.added, { key }));
    };
    ok.addEventListener("click", submit);
    cancel.addEventListener("click", close);
    form.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        close();
      } else if (ev.key === "Enter" && ev.target !== cancel && ev.target !== ok && !ev.isComposing) {
        ev.preventDefault();
        submit();
      }
    });
    addBox.replaceWith(form);
    name.focus();
  }

  return root;
}

/** Find the element of a panel that carries a focus id (`toggle`, `add`, `value:<key>`, ...). */
export function findFocus(root: ParentNode, id: string): HTMLElement | null {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-fm-focus]"))) if (el.getAttribute("data-fm-focus") === id) return el;
  return null;
}
