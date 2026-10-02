/**
 * Rendering for the editing surface: `renderDom` output plus the extra data
 * the surface needs to rebuild the exact Doc from the DOM (dom-to-doc.ts).
 *
 * renderDom is display-oriented: it rewrites URLs through `links.resolve`,
 * drops refused links/images, sanitises code languages and lower-cases custom
 * data keys. None of that may leak into the stored Markdown, so after
 * rendering we walk the Doc in render order next to the DOM and record the
 * originals as `data-*` attributes:
 *
 *   a.atm-link        data-href            (original href)
 *   img.atm-img       data-src             (original src)
 *   span.atm-chip     data-label           + contenteditable=false
 *   .atm-math         data-tex             + contenteditable=false
 *   pre.atm-pre       data-lang data-fence
 *   .atm-custom       data-atm-name data-atm-data (JSON)
 *   sup.footnote-ref  data-label           + contenteditable=false
 *   li.atm-footnote   data-label           (back links removed)
 *
 * Refused links/images are rendered as `custom` nodes named `__atmlink` /
 * `__atmimg` (a span carrying the original URL as data, never a live link),
 * so editing a document never silently deletes them.
 */
import type { BlockNode, Doc, InlineNode, RenderOptions } from "../../types";
import { embedOf, renderDom, safeUrl } from "../../render/index";

export const LINK_X = "__atmlink";
export const IMG_X = "__atmimg";

type Inl = InlineNode;

function prepInline(ns: Inl[], o: RenderOptions): Inl[] {
  let changed = false;
  const out = ns.map((n): Inl => {
    let r: Inl = n;
    switch (n.type) {
      case "link": {
        const kids = prepInline(n.children, o);
        if (safeUrl(n.href, o.links, "link") === null) {
          const data: Record<string, string> = { href: n.href };
          if (n.title) data.title = n.title;
          r = { type: "custom", name: LINK_X, children: kids, data };
        } else if (kids !== n.children) r = { ...n, children: kids };
        break;
      }
      case "image":
        if (safeUrl(n.src, o.links, "image") === null) {
          const data: Record<string, string> = { src: n.src, alt: n.alt };
          if (n.title) data.title = n.title;
          if (n.width) data.width = String(n.width);
          if (n.align) data.align = n.align;
          r = { type: "custom", name: IMG_X, children: [{ type: "text", value: n.alt || n.src }], data };
        }
        break;
      case "emphasis":
      case "strong":
      case "strike":
      case "custom": {
        const kids = prepInline(n.children, o);
        if (kids !== n.children) r = { ...n, children: kids } as Inl;
        break;
      }
    }
    if (r !== n) changed = true;
    return r;
  });
  return changed ? out : ns;
}

function prepBlocks(bs: BlockNode[], o: RenderOptions): BlockNode[] {
  let changed = false;
  const out = bs.map((b): BlockNode => {
    let r: BlockNode = b;
    switch (b.type) {
      case "paragraph":
      case "heading": {
        const c = prepInline(b.children, o);
        if (c !== b.children) r = { ...b, children: c };
        break;
      }
      case "blockquote":
      case "footnoteDef":
      case "custom": {
        const c = prepBlocks(b.children, o);
        if (c !== b.children) r = { ...b, children: c } as BlockNode;
        break;
      }
      case "list":
        r = { ...b, items: b.items.map((it) => ({ ...it, children: prepBlocks(it.children, o) })) };
        break;
      case "table":
        r = { ...b, head: b.head.map((c) => prepInline(c, o)), rows: b.rows.map((row) => row.map((c) => prepInline(c, o))) };
        break;
    }
    if (r !== b) changed = true;
    return r;
  });
  return changed ? out : bs;
}

export function prepDoc(doc: Doc, o: RenderOptions): Doc {
  const c = prepBlocks(doc.children, o);
  return c === doc.children ? doc : { type: "doc", children: c };
}

type Col = {
  links: Extract<Inl, { type: "link" }>[];
  images: Extract<Inl, { type: "image" }>[];
  chips: Extract<Inl, { type: "chip" }>[];
  maths: { tex: string }[];
  codes: Extract<BlockNode, { type: "codeBlock" }>[];
  customs: { name: string; data?: Record<string, string> }[];
  refs: string[];
  defs: string[];
};

/** Visit the Doc in exactly the order `renderDom` emits elements. */
function collect(doc: Doc, o: RenderOptions): Col {
  const col: Col = { links: [], images: [], chips: [], maths: [], codes: [], customs: [], refs: [], defs: [] };
  const fns: Extract<BlockNode, { type: "footnoteDef" }>[] = [];
  const findDefs = (bs: BlockNode[]) => {
    for (const b of bs) {
      if (b.type === "footnoteDef") fns.push(b);
      else if (b.type === "blockquote" || b.type === "custom") findDefs(b.children);
      else if (b.type === "list") for (const it of b.items) findDefs(it.children);
    }
  };
  findDefs(doc.children);
  const labels = new Set(fns.map((f) => f.label));
  const inl = (ns: Inl[]) => {
    for (const n of ns) {
      switch (n.type) {
        case "link":
          col.links.push(n);
          inl(n.children);
          break;
        case "image":
          col.images.push(n);
          break;
        case "chip":
          col.chips.push(n);
          break;
        case "math":
          col.maths.push(n);
          break;
        case "footnoteRef":
          if (labels.has(n.label)) col.refs.push(n.label);
          break;
        case "custom":
          col.customs.push(n);
          inl(n.children);
          break;
        case "emphasis":
        case "strong":
        case "strike":
          inl(n.children);
          break;
      }
    }
  };
  const blocks = (bs: BlockNode[]) => {
    for (const b of bs) {
      switch (b.type) {
        case "paragraph":
        case "heading":
          inl(b.children);
          break;
        case "blockquote":
          blocks(b.children);
          break;
        case "list":
          for (const it of b.items) blocks(it.children);
          break;
        case "codeBlock":
          col.codes.push(b);
          break;
        case "math":
          col.maths.push(b);
          break;
        case "table":
          for (const c of b.head) inl(c);
          for (const r of b.rows) for (const c of r) inl(c);
          break;
        case "custom":
          col.customs.push(b);
          blocks(b.children);
          break;
      }
    }
  };
  for (const b of doc.children) if (!embedOf(b, o)) blocks([b]); // an embed block has no link to pair
  for (const f of fns) {
    col.defs.push(f.label);
    blocks(f.children);
  }
  return col;
}

export type SurfaceRenderCtx = {
  render: RenderOptions;
  prefix: string;
  document: Document;
  editable: boolean;
  taskLabel: string;
};

const INLINE_RUN_BREAK = /^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR|DIV|SECTION|ASIDE|DETAILS|SUMMARY|FIGURE)$/;

/** Classes the renderer would put on a node type (prefix + per-type extras). */
export function cls(ctx: SurfaceRenderCtx, name: string, type?: string): string {
  const x = ctx.render.classNames?.[type ?? name];
  return `${ctx.prefix}-${name}` + (x ? " " + x : "");
}

/** Mark up a rendered fragment for editing. */
export function decorate(root: ParentNode, doc: Doc, ctx: SurfaceRenderCtx): void {
  const p = ctx.prefix;
  const col = collect(doc, ctx.render);
  const all = (sel: string) =>
    Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((e) => !e.parentElement?.closest(`.${p}-chip, .${p}-math`));
  all(`a.${p}-link`).forEach((e, i) => {
    const n = col.links[i];
    if (n) e.setAttribute("data-href", n.href);
  });
  all(`img.${p}-img`).forEach((e, i) => {
    const n = col.images[i];
    if (n) e.setAttribute("data-src", n.src);
    e.setAttribute("draggable", "false");
  });
  all(`span.${p}-chip`).forEach((e, i) => {
    const n = col.chips[i];
    if (n) e.setAttribute("data-label", n.label);
    e.setAttribute("contenteditable", "false");
  });
  all(`.${p}-math`).forEach((e, i) => {
    const n = col.maths[i];
    if (n) e.setAttribute("data-tex", n.tex);
    e.setAttribute("contenteditable", "false");
  });
  all(`pre.${p}-pre`).forEach((e, i) => {
    const n = col.codes[i];
    if (!n) return;
    if (n.lang) e.setAttribute("data-lang", n.lang);
    e.setAttribute("data-fence", n.fence);
    e.setAttribute("spellcheck", "false");
    const code = e.firstElementChild ?? e;
    if (!n.code || n.code.endsWith("\n")) code.appendChild(ctx.document.createElement("br"));
  });
  all(`.${p}-custom`).forEach((e, i) => {
    const n = col.customs[i];
    if (!n) return;
    e.setAttribute("data-atm-name", n.name);
    if (n.data && Object.keys(n.data).length) e.setAttribute("data-atm-data", JSON.stringify(n.data));
    if (n.name === IMG_X) {
      e.setAttribute("contenteditable", "false");
      e.classList.add(`${p}-img-blocked`);
    }
    const sm = e.tagName === "DETAILS" ? e.firstElementChild : null;
    if (sm) {
      // The default summary label is a placeholder while editing, never content.
      sm.setAttribute("data-placeholder", ctx.render.labels?.details || "Details");
      if (!n.data?.summary) sm.textContent = "";
    }
  });
  all(`sup.${p}-footnote-ref`).forEach((e, i) => {
    const l = col.refs[i];
    if (l !== undefined) e.setAttribute("data-label", l);
    e.setAttribute("contenteditable", "false");
  });
  root.querySelectorAll<HTMLElement>(`section.${p}-footnotes`).forEach((s) => {
    s.querySelectorAll<HTMLElement>(`li.${p}-footnote`).forEach((li, i) => {
      const l = col.defs[i];
      if (l !== undefined) li.setAttribute("data-label", l);
    });
    s.querySelectorAll(`a.${p}-footnote-back`).forEach((a) => {
      const prev = a.previousSibling;
      if (prev && prev.nodeType === 3 && (prev as Text).data === " ") prev.remove();
      a.remove();
    });
  });
  root.querySelectorAll<HTMLInputElement>(`input.${p}-task-box`).forEach((b) => prepCheckbox(b, ctx));
  // A captioned image is one atom (its caption is edited from the image toolbar, not inline).
  all(`figure.${p}-figure`).forEach((e) => e.setAttribute("contenteditable", "false"));
  // A collapsible section always has a body block the caret can enter.
  all(`details.${p}-details`).forEach((e) => {
    if (e.lastElementChild?.tagName === "SUMMARY") e.appendChild(ctx.document.createElement("p")).className = cls(ctx, "p", "paragraph");
  });
  // Every list item holds blocks: wrap the inline run of a tight item in <p>.
  root.querySelectorAll<HTMLElement>("li").forEach((li) => {
    if (li.classList.contains(`${p}-footnote`)) return;
    wrapRuns(li, ctx);
  });
  root.querySelectorAll<HTMLElement>(`p, h1, h2, h3, h4, h5, h6, td, th, summary`).forEach(fill);
}

export function prepCheckbox(b: HTMLInputElement, ctx: SurfaceRenderCtx): void {
  b.setAttribute("contenteditable", "false");
  b.setAttribute("aria-label", ctx.taskLabel);
  b.tabIndex = -1;
  if (ctx.editable) b.removeAttribute("disabled");
  else b.setAttribute("disabled", "");
  b.disabled = !ctx.editable;
}

/** Wrap consecutive inline children of `el` in paragraphs. Returns true when something moved. */
export function wrapRuns(el: HTMLElement, ctx: SurfaceRenderCtx): boolean {
  let moved = false;
  let run: Node[] = [];
  const flush = (before: Node | null) => {
    const r = run;
    run = [];
    if (!r.some((n) => (n.nodeType === 3 ? /\S| /.test((n as Text).data) : true))) return;
    const p = ctx.document.createElement("p");
    p.className = cls(ctx, "p", "paragraph");
    el.insertBefore(p, before);
    for (const n of r) p.appendChild(n);
    moved = true;
  };
  for (let c = el.firstChild; c; ) {
    const next = c.nextSibling;
    const isInput = c.nodeType === 1 && (c as HTMLElement).tagName === "INPUT";
    if (c.nodeType === 1 && INLINE_RUN_BREAK.test((c as HTMLElement).tagName)) flush(c);
    else if (!isInput && (c.nodeType === 1 || c.nodeType === 3)) run.push(c);
    c = next;
  }
  flush(null);
  if (el.tagName === "LI") {
    let has = false;
    for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (c as HTMLElement).tagName !== "INPUT") has = true;
    if (!has) {
      const p = ctx.document.createElement("p");
      p.className = cls(ctx, "p", "paragraph");
      p.appendChild(ctx.document.createElement("br"));
      el.appendChild(p);
      moved = true;
    }
  }
  return moved;
}

/** An empty text block gets a <br> so the caret can sit in it. */
export function fill(el: Element): void {
  if (!el.firstChild) el.appendChild(el.ownerDocument!.createElement("br"));
}

export function renderFragment(doc: Doc, ctx: SurfaceRenderCtx): DocumentFragment {
  const prepped = prepDoc(doc, ctx.render);
  const frag = renderDom(prepped, ctx.render, ctx.document);
  decorate(frag, prepped, ctx);
  return frag;
}

/**
 * Footnote definitions render at the end. Record where each top-level one was
 * so serialisation can put it back: the rendered element it followed gets
 * `data-atm-fn` (JSON label list); ones before every block go on the section.
 */
export function anchorFootnotes(frag: ParentNode, doc: Doc, ctx: SurfaceRenderCtx): void {
  const els = Array.from(frag.children).filter((e) => !(e.tagName === "SECTION" && e.classList.contains(`${ctx.prefix}-footnotes`)));
  const section = Array.from(frag.children).find((e) => e.tagName === "SECTION" && e.classList.contains(`${ctx.prefix}-footnotes`));
  if (!section) return;
  let k = -1;
  const after = new Map<number, string[]>();
  for (const b of doc.children) {
    if (b.type === "footnoteDef") {
      const list = after.get(k) ?? [];
      list.push(b.label);
      after.set(k, list);
    } else k++;
  }
  for (const [i, labels] of after) {
    if (i < 0) section.setAttribute("data-atm-fn-start", JSON.stringify(labels));
    else if (els[i]) els[i].setAttribute("data-atm-fn", JSON.stringify(labels));
  }
}

/** Inline nodes rendered and decorated, ready to insert. */
export function renderInlineNodes(nodes: Inl[], ctx: SurfaceRenderCtx): Node[] {
  // The empty text keeps a lone captioned image an inline image (no figure) and is dropped again.
  const frag = renderFragment({ type: "doc", children: [{ type: "paragraph", children: [...nodes, { type: "text", value: "" }] }] }, ctx);
  const p = frag.firstChild;
  if (!p) return [];
  const out = Array.from(p.childNodes).filter((n) => n.nodeType !== 3 || (n as Text).data);
  if (out.length === 1 && out[0].nodeType === 1 && (out[0] as Element).tagName === "BR" && !nodes.some((n) => n.type === "break")) return [];
  return out;
}

/** One block rendered and decorated. */
export function renderBlockEls(blocks: BlockNode[], ctx: SurfaceRenderCtx): HTMLElement[] {
  const frag = renderFragment({ type: "doc", children: blocks }, ctx);
  return Array.from(frag.children) as HTMLElement[];
}
