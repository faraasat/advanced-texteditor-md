/**
 * The sidebar layout: a document page with a live outline (the headings tree) on one side and an
 * inspector on the other (words, characters, reading time, mentions, links, images). Every entry is
 * a button that moves the caret there and scrolls it into view, in WYSIWYG and in Markdown mode.
 * Two toggle buttons in the toolbar row show and hide the panels; in a narrow editor the panels are
 * closed and open over the page. A lazy chunk.
 */
import type { BlockNode, Doc, InlineNode } from "../../types";
import type { LayoutHost } from "../layouts";
import { h, uid } from "../dom";
import { fmt, iconOf, labelsOf, textStats } from "../chrome/kit";
import { attach as statusExtras } from "../chrome/status-extra";

/** English defaults of this chunk's strings (a host overrides any of them through `labels`). */
export const SIDEBAR_LABELS = {
  outline: "Outline",
  outlineEmpty: "Headings appear here",
  inspector: "Document",
  wordsLabel: "Words",
  charactersLabel: "Characters",
  headingsLabel: "Headings",
  mentionsLabel: "Mentions",
  linksLabel: "Links",
  imagesLabel: "Images",
  noneYet: "None",
  togglePanel: "Toggle {name}",
  panels: "Panels",
};

export type OutlineEntry = { level: number; text: string; index: number };
export type Inspection = {
  headings: OutlineEntry[];
  mentions: { label: string; trigger: string; scheme: string; kind: string; id: string }[];
  links: { text: string; href: string; index: number }[];
  images: { alt: string; src: string; index: number }[];
};

/** Plain text of inline nodes (chips with their trigger, images by alt, math as TeX). */
export function inlineText(nodes: InlineNode[]): string {
  let s = "";
  for (const n of nodes) {
    if (n.type === "text" || n.type === "code") s += n.value;
    else if (n.type === "chip") s += (n.trigger ?? "") + n.label;
    else if (n.type === "image") s += n.alt;
    else if (n.type === "math") s += n.tex;
    else if (n.type === "break") s += " ";
    else if ("children" in n) s += inlineText(n.children);
  }
  return s;
}

/** Headings, mentions, links and images of a document, in document order. Pure. */
export function inspect(doc: Doc): Inspection {
  const out: Inspection = { headings: [], mentions: [], links: [], images: [] };
  const seen = new Set<string>();
  const inl = (nodes: InlineNode[]) => {
    for (const n of nodes) {
      if (n.type === "chip") {
        const k = `${n.scheme}:${n.kind}:${n.id}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.mentions.push({ label: n.label, trigger: n.trigger ?? "", scheme: n.scheme, kind: n.kind, id: n.id });
        }
      } else if (n.type === "link") {
        out.links.push({ text: inlineText(n.children) || n.href, href: n.href, index: out.links.length });
        inl(n.children);
      } else if (n.type === "image") out.images.push({ alt: n.alt, src: n.src, index: out.images.length });
      else if ("children" in n) inl(n.children);
    }
  };
  const blocks = (bs: BlockNode[]) => {
    for (const b of bs) {
      if (b.type === "heading") {
        out.headings.push({ level: b.level, text: inlineText(b.children).trim(), index: out.headings.length });
        inl(b.children);
      } else if (b.type === "paragraph") inl(b.children);
      else if (b.type === "list") for (const it of b.items) blocks(it.children);
      else if (b.type === "table") {
        for (const c of b.head) inl(c);
        for (const r of b.rows) for (const c of r) inl(c);
      } else if ("children" in b) blocks(b.children as BlockNode[]);
    }
  };
  blocks(doc.children);
  return out;
}

/** Line numbers (0-based) of the ATX headings of `md`, skipping fenced code. Pure. */
export function headingLines(md: string): number[] {
  const out: number[] = [];
  let fence: string | null = null;
  md.split("\n").forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (!fence && /^ {0,3}#{1,6}(\s|$)/.test(line)) out.push(i);
  });
  return out;
}

const reduce = (win: Window | null) => !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Move the caret to `target` (a block or inline element in the surface) and bring it into view. */
function jumpTo(host: LayoutHost, target: Element | null) {
  if (!target) return;
  host.editor.focus();
  const sel = host.doc.getSelection();
  const r = host.doc.createRange();
  r.selectNodeContents(target);
  r.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(r);
  target.scrollIntoView?.({ block: "center", behavior: reduce(host.doc.defaultView) ? "auto" : "smooth" });
}

/** Markdown mode: put the textarea's caret at `offset` and scroll that line into view. */
function jumpInMarkdown(host: LayoutHost, offset: number) {
  const ta = host.regions.markdownPane.querySelector("textarea");
  if (!ta) return;
  ta.focus();
  ta.setSelectionRange(offset, offset);
  const line = ta.value.slice(0, offset).split("\n").length - 1;
  const lh = parseFloat(host.doc.defaultView?.getComputedStyle(ta).lineHeight ?? "") || 22;
  ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3);
}

export function attach(host: LayoutHost): () => void {
  const { doc, prefix: p, regions, editor: ed } = host;
  const L = labelsOf(host, SIDEBAR_LABELS);
  const opts = ed.options.layoutOptions?.sidebar ?? {};
  const body = regions.surface.parentElement!;
  const offs: (() => void)[] = [];
  const outlineTitle = uid(`${p}-ol`);
  const inspTitle = uid(`${p}-in`);
  const outline = h("nav", { document: doc, class: `${p}-side ${p}-side-outline`, "aria-labelledby": outlineTitle, id: uid(`${p}-side`), "data-atm-chrome": "" }, h("div", { document: doc, class: `${p}-side-title`, id: outlineTitle }, L.outline));
  const insp = h("section", { document: doc, class: `${p}-side ${p}-side-inspector`, "aria-labelledby": inspTitle, id: uid(`${p}-side`), "data-atm-chrome": "" }, h("div", { document: doc, class: `${p}-side-title`, id: inspTitle }, L.inspector));
  const tree = h("ul", { document: doc, class: `${p}-outline` });
  outline.appendChild(tree);
  const stats = h("dl", { document: doc, class: `${p}-stats` });
  const lists = h("div", { document: doc, class: `${p}-insp-lists` });
  insp.append(stats, lists);
  const showOutline = opts.outline !== false;
  const showInspector = opts.inspector !== false;
  const end = opts.side === "end";
  if (showOutline) end ? body.appendChild(outline) : body.insertBefore(outline, body.firstChild);
  if (showInspector) end ? body.insertBefore(insp, body.firstChild) : body.appendChild(insp);
  regions.root.classList.add(`${p}-has-side`);
  if (end) regions.root.setAttribute("data-atm-side", "end");

  // Toggles in the toolbar row (before the mode switch), and the narrow-editor behaviour.
  const toggles = h("div", { document: doc, class: `${p}-side-toggles`, role: "group", "aria-label": L.panels });
  const toggle = (panel: HTMLElement, name: string, icon: string) => {
    const b = h("button", { document: doc, type: "button", class: `${p}-btn ${p}-side-toggle`, "aria-controls": panel.id, "aria-expanded": "true", "aria-label": fmt(L.togglePanel, { name }) }, iconOf(host, icon));
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => setOpen(panel, b, panel.hidden));
    toggles.appendChild(b);
    return b;
  };
  const setOpen = (panel: HTMLElement, b: HTMLElement, v: boolean) => {
    panel.hidden = !v;
    b.setAttribute("aria-expanded", String(v));
    b.classList.toggle(`${p}-active`, v);
    if (v && narrow) (panel.querySelector<HTMLElement>("button") ?? panel).focus();
  };
  const tOutline = showOutline ? toggle(outline, L.outline, "outline") : null;
  const tInsp = showInspector ? toggle(insp, L.inspector, "inspector") : null;
  const row = regions.toolbar;
  if (row) row.insertBefore(toggles, row.querySelector(`.${p}-mode-switch`) ?? null);
  else regions.statusBar?.appendChild(toggles);
  // Wide (>= 1040 px): both panels; medium: the outline only (the inspector opens beside it);
  // narrow (< 720 px): both closed, and each opens over the page.
  let narrow = false;
  let size = "";
  const win = doc.defaultView;
  const measure = () => {
    const w = regions.root.clientWidth;
    const next = !w ? size : w < 720 ? "narrow" : w < 1040 ? "medium" : "wide";
    if (next === size) return;
    size = next;
    narrow = next === "narrow";
    regions.root.classList.toggle(`${p}-side-narrow`, narrow);
    regions.root.setAttribute("data-atm-side-size", next);
    if (tOutline) setOpen(outline, tOutline, next !== "narrow");
    if (tInsp) setOpen(insp, tInsp, next === "wide");
  };
  const ro = win && typeof win.ResizeObserver === "function" ? new win.ResizeObserver(measure) : null;
  ro?.observe(regions.root);
  offs.push(() => ro?.disconnect());
  // Escape in an overlay panel closes it and returns to its toggle.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !narrow) return;
    const panel = (e.currentTarget as HTMLElement);
    const b = panel === outline ? tOutline : tInsp;
    if (b) {
      e.stopPropagation();
      setOpen(panel, b, false);
      b.focus();
    }
  };
  outline.addEventListener("keydown", onKey);
  insp.addEventListener("keydown", onKey);

  /* ── drawing ── */

  let data: Inspection = { headings: [], mentions: [], links: [], images: [] };
  const btn = (label: string, run: () => void, cls = "", sub?: string) => {
    const b = h("button", { document: doc, type: "button", class: `${p}-side-link ${cls}` }, h("span", { document: doc, class: `${p}-side-text` }, label), sub ? h("span", { document: doc, class: `${p}-side-sub` }, sub) : null);
    b.addEventListener("click", () => {
      run();
      if (narrow) for (const [pn, t] of [[outline, tOutline], [insp, tInsp]] as const) if (t) setOpen(pn, t, false);
    });
    return b;
  };
  const jumpHeading = (i: number) => {
    if (ed.getMode() === "wysiwyg") return jumpTo(host, regions.surface.querySelectorAll("h1,h2,h3,h4,h5,h6")[i] ?? null);
    const line = headingLines(ed.getValue())[i];
    if (line !== undefined) jumpInMarkdown(host, ed.getValue().split("\n").slice(0, line).join("\n").length + (line ? 1 : 0));
  };
  const jumpFind = (sel: string, i: number, needle: string) => {
    if (ed.getMode() === "wysiwyg") return jumpTo(host, regions.surface.querySelectorAll(sel)[i] ?? null);
    const at = ed.getValue().indexOf(needle);
    if (at >= 0) jumpInMarkdown(host, at);
  };

  let drawn: string | null = null;
  function draw() {
    drawn = ed.getValue();
    data = inspect(ed.getAst());
    tree.textContent = "";
    if (!data.headings.length) tree.appendChild(h("li", { document: doc, class: `${p}-side-empty` }, L.outlineEmpty));
    const min = Math.min(...data.headings.map((x) => x.level), 6);
    for (const hd of data.headings) {
      const li = h("li", { document: doc, class: `${p}-outline-item`, style: `--atm-depth:${hd.level - min}`, "data-level": String(hd.level) });
      li.appendChild(btn(hd.text || "…", () => jumpHeading(hd.index), `${p}-outline-link`));
      tree.appendChild(li);
    }
    const st = textStats(ed.getText(), ed.options.statusBar?.wordsPerMinute);
    stats.textContent = "";
    for (const [k, v] of [[L.wordsLabel, String(st.words)], [L.charactersLabel, String(st.characters)], [L.readingTimeLabel, st.words ? fmt(L.readingTime, { n: st.minutes }) : "—"], [L.headingsLabel, String(data.headings.length)]])
      stats.append(h("div", { document: doc, class: `${p}-stat` }, h("dt", { document: doc }, k), h("dd", { document: doc }, v)));
    lists.textContent = "";
    const section = (title: string, rows: HTMLElement[]) => {
      const d = h("details", { document: doc, class: `${p}-insp-section`, open: true }, h("summary", { document: doc }, `${title} (${rows.length})`));
      const ul = h("ul", { document: doc, class: `${p}-insp-list` });
      if (!rows.length) ul.appendChild(h("li", { document: doc, class: `${p}-side-empty` }, L.noneYet));
      for (const r of rows) ul.appendChild(h("li", { document: doc }, r));
      d.appendChild(ul);
      lists.appendChild(d);
    };
    section(L.mentionsLabel, data.mentions.map((m) => btn(m.trigger + m.label, () => jumpFind(`.${p}-chip[data-id="${m.id.replace(/["\\]/g, "\\$&")}"]`, 0, `](${m.scheme}:`), `${p}-insp-mention`, m.kind || undefined)));
    section(L.linksLabel, data.links.map((l) => btn(l.text, () => jumpFind(`a[href]:not(.${p}-chip)`, l.index, `](${l.href}`), "", l.href)));
    section(L.imagesLabel, data.images.map((im) => btn(im.alt || im.src.split("/").pop() || im.src, () => jumpFind("img", im.index, `](${im.src}`), "", im.alt ? im.src.split("/").pop() : undefined)));
    current();
  }

  /** Mark the outline entry of the heading the caret is under. */
  function current() {
    const items = Array.from(tree.querySelectorAll(`.${p}-outline-link`));
    let at = -1;
    if (ed.getMode() === "wysiwyg") {
      const sel = doc.getSelection();
      const node = sel?.anchorNode;
      if (node && regions.surface.contains(node)) {
        Array.from(regions.surface.querySelectorAll("h1,h2,h3,h4,h5,h6")).forEach((hd, i) => {
          if (hd === node || hd.contains(node) || hd.compareDocumentPosition(node) & 4) at = i;
        });
      }
    } else {
      const ta = regions.markdownPane.querySelector("textarea");
      if (ta) {
        const line = ta.value.slice(0, ta.selectionStart).split("\n").length - 1;
        headingLines(ta.value).forEach((l, i) => l <= line && (at = i));
      }
    }
    items.forEach((b, i) => (i === at ? b.setAttribute("aria-current", "location") : b.removeAttribute("aria-current")));
  }

  let t: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(t);
    t = setTimeout(draw, 120);
  };
  offs.push(ed.on("change", later), ed.on("mode", draw), ed.on("selection", current), host.onUpdate(() => (ed.getValue() !== drawn ? later() : current())), () => clearTimeout(t));
  if (!host.statusItems) {
    const off = statusExtras(host, ["words", "readingTime", "selection", "count", "upload", "save", "mode"]);
    offs.push(off);
  }
  draw();
  measure();
  return () => {
    for (const off of offs) off();
    outline.remove();
    insp.remove();
    toggles.remove();
    regions.root.classList.remove(`${p}-has-side`, `${p}-side-narrow`);
    regions.root.removeAttribute("data-atm-side");
  };
}
