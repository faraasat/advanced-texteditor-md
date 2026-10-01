import type { BlockNode, Doc, InlineNode, RenderOptions } from "../types";
import { inlineToText, parse } from "../parser/index";
import { safeUrl, isExternal } from "./policy";

export { safeUrl } from "./policy";

type El = { t: string; a: Record<string, string>; c: VN[] };
type VN = string | El | { raw: string } | { el: any };

const el = (t: string, a: Record<string, string | undefined>, c: VN[] = []): El => {
  const o: Record<string, string> = {};
  for (const k in a) if (a[k] !== undefined) o[k] = a[k]!;
  return { t, a: o, c };
};

const TAGS = new Set(["span", "mark", "u", "kbd", "sub", "sup", "small", "abbr", "div", "aside", "section", "details", "summary"]);
const BLOCK_TAGS = new Set(["div", "aside", "section", "details"]);
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "cite", "data", "background", "ping", "codebase", "manifest"]);
const VOID = new Set(["br", "hr", "img", "input"]);

const escH = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
const safeColor = (c: string) => /^[#\w\s%.,()\/-]+$/.test(c) && !/url\(|expression|javascript/i.test(c);
const fnId = (l: string) => l.replace(/[^\w-]/g, (c) => "_" + c.charCodeAt(0).toString(16));

function toVN(doc: Doc, o: RenderOptions): VN[] {
  const p = o.classPrefix ?? "atm";
  const k = (name: string, type?: string) => {
    const x = o.classNames?.[type ?? name];
    return `${p}-${name}` + (x ? " " + x : "");
  };
  const pol = o.links;
  const fns: Extract<BlockNode, { type: "footnoteDef" }>[] = [];
  const collect = (bs: BlockNode[]) => {
    for (const b of bs) {
      if (b.type === "footnoteDef") fns.push(b);
      else if (b.type === "blockquote" || b.type === "custom") collect(b.children);
      else if (b.type === "list") for (const it of b.items) collect(it.children);
    }
  };
  collect(doc.children);
  const fnNum = new Map(fns.map((f, i) => [f.label, i + 1]));

  const safeAttrs = (src: Record<string, string> | undefined, into: Record<string, string>) => {
    for (const [n, v] of Object.entries(src ?? {})) {
      if (!/^[a-z][a-z0-9-]*$/.test(n) || n.startsWith("on") || n === "srcset" || n === "class") continue;
      if (URL_ATTRS.has(n)) {
        const u = safeUrl(v, pol, "link");
        if (u === null) continue;
        into[n] = u;
      } else if (n === "style") {
        if (!/url\(|expression|javascript|@import|[<>]/i.test(v)) into[n] = v;
      } else into[n] = String(v);
    }
  };
  const custom = (kind: "inline" | "block", name: string, data: Record<string, string> | undefined, kids: VN[]) => {
    const sy = (o.syntax?.[kind] as { name: string; tag?: string; className?: string; attrs?: Record<string, string> }[] | undefined)?.find(
      (s) => s.name === name,
    );
    const dflt = kind === "inline" ? "span" : "div";
    let tag = sy?.tag && TAGS.has(sy.tag) ? sy.tag : dflt;
    if (kind === "inline" && BLOCK_TAGS.has(tag)) tag = "span";
    const cls = [k("custom", "custom"), k("custom-" + slug(name)), sy?.className].filter(Boolean).join(" ");
    const a: Record<string, string> = { class: cls };
    safeAttrs(sy?.attrs, a);
    for (const [dk, dv] of Object.entries(data ?? {})) {
      if (dk[0] !== "_" && /^[a-z][a-z0-9-]*$/i.test(dk)) a["data-" + dk.toLowerCase()] = dv;
    }
    return el(tag, a, kids);
  };

  const chip = (c: Extract<InlineNode, { type: "chip" }>): VN => {
    const def = o.chips?.[`${c.scheme}:${c.kind}`] ?? o.chips?.[c.scheme];
    const kd = def?.kinds?.[c.kind];
    const cls = [
      k("chip", "chip"),
      k("chip-" + slug(c.scheme)),
      c.kind && k("chip-kind-" + slug(c.kind)),
      def?.className,
      kd?.className,
    ]
      .filter(Boolean)
      .join(" ");
    const a: Record<string, string | undefined> = {
      class: cls,
      "data-scheme": c.scheme,
      "data-kind": c.kind || undefined,
      "data-id": c.id,
      "data-trigger": c.trigger,
      "data-refs": c.attrs && Object.keys(c.attrs).length ? JSON.stringify(c.attrs) : undefined,
    };
    const col = kd?.color;
    if (typeof col === "number" && col >= 1 && col <= 8) a.style = `--${p}-chip-color:var(--${p}-chip-${Math.trunc(col)})`;
    else if (typeof col === "string" && safeColor(col)) a.style = `--${p}-chip-color:${col}`;
    const kids: VN[] = [];
    let custom: string | HTMLElement | undefined;
    try {
      custom = def?.render?.(c);
    } catch {
      /* fall back to the default label */
    }
    if (custom !== undefined) kids.push(typeof custom === "string" ? { raw: custom } : { el: custom });
    else {
      kids.push((c.trigger ?? "") + c.label);
      if (kd?.label) kids.push(el("span", { class: k("chip-badge") }, [kd.label]));
    }
    return el("span", a, kids);
  };

  const inl = (nodes: InlineNode[]): VN[] => nodes.flatMap(inline);
  const inline = (n: InlineNode): VN[] => {
    switch (n.type) {
      case "text":
        return [n.value];
      case "emphasis":
        return [el("em", { class: k("em", "emphasis") }, inl(n.children))];
      case "strong":
        return [el("strong", { class: k("strong") }, inl(n.children))];
      case "strike":
        return [el("del", { class: k("del", "strike") }, inl(n.children))];
      case "code":
        return [el("code", { class: k("code") + " " + k("code-inline") }, [n.value])];
      case "break":
        return [el("br", {})];
      case "math":
        return [el("span", { class: k("math", "math") + " " + k("math-inline") }, [mathVN(n.tex, false)])];
      case "footnoteRef": {
        const num = fnNum.get(n.label);
        if (!num) return [`[^${n.label}]`];
        const id = fnId(n.label);
        return [el("sup", { class: k("footnote-ref", "footnoteRef") }, [el("a", { href: "#fn-" + id, id: "fnref-" + id }, [String(num)])])];
      }
      case "chip":
        return [chip(n)];
      case "custom":
        return [custom("inline", n.name, n.data, inl(n.children))];
      case "link": {
        const u = safeUrl(n.href, pol, "link");
        if (u === null) return inl(n.children);
        const ext = isExternal(u);
        return [
          el(
            "a",
            {
              class: k("link", "link"),
              href: u,
              title: n.title,
              rel: ext ? (pol?.rel ?? "noopener noreferrer nofollow") : undefined,
              target: ext ? (pol?.target ?? "_blank") : undefined,
            },
            inl(n.children),
          ),
        ];
      }
      case "image": {
        const u = safeUrl(n.src, pol, "image");
        if (u === null) return [n.alt];
        return [el("img", { class: k("img", "image"), src: u, alt: n.alt, title: n.title, loading: "lazy" })];
      }
    }
  };

  const mathVN = (tex: string, display: boolean): VN => {
    if (o.mathRenderer) {
      try {
        const r = o.mathRenderer(tex, display);
        return typeof r === "string" ? { raw: r } : { el: r };
      } catch {
        /* show the source */
      }
    }
    return el("code", { class: k("math-src") }, [tex]);
  };

  const blocks = (bs: BlockNode[], tight = false): VN[] => bs.flatMap((b) => block(b, tight));
  const block = (b: BlockNode, tight: boolean): VN[] => {
    switch (b.type) {
      case "paragraph":
        return tight ? inl(b.children) : [el("p", { class: k("p", "paragraph") }, inl(b.children))];
      case "heading":
        return [el("h" + b.level, { class: k("h" + b.level, "heading") }, inl(b.children))];
      case "blockquote":
        return [el("blockquote", { class: k("blockquote") }, blocks(b.children))];
      case "list":
        return [
          el(
            b.ordered ? "ol" : "ul",
            {
              class: k(b.ordered ? "ol" : "ul", "list") + (b.tight ? " " + k("tight") : ""),
              start: b.ordered && b.start !== 1 ? String(b.start) : undefined,
            },
            b.items.map((it) => {
              const task = it.checked !== undefined;
              const kids: VN[] = [];
              if (task) kids.push(el("input", { type: "checkbox", class: k("task-box"), disabled: "", checked: it.checked ? "" : undefined }));
              kids.push(...blocks(it.children, b.tight));
              return el(
                "li",
                { class: k("li", "listItem") + (task ? " " + k("task") + (it.checked ? " " + k("task-done") : "") : "") },
                kids,
              );
            }),
          ),
        ];
      case "codeBlock": {
        let body: VN = b.code;
        if (o.highlight) {
          try {
            body = { raw: o.highlight.highlight(b.code, b.lang) };
          } catch {
            /* escaped text */
          }
        }
        const lang = b.lang.replace(/[^\w+#.-]/g, "");
        return [
          el("pre", { class: k("pre", "codeBlock") }, [
            el("code", { class: k("code") + (lang ? " language-" + lang : ""), "data-lang": lang || undefined }, [body]),
          ]),
        ];
      }
      case "math":
        return [el("div", { class: k("math", "math") + " " + k("math-block") }, [mathVN(b.tex, true)])];
      case "table": {
        const cell = (tag: string, c: InlineNode[], i: number) =>
          el(tag, { scope: tag === "th" ? "col" : undefined, style: b.align[i] ? `text-align:${b.align[i]}` : undefined }, inl(c));
        return [
          el("table", { class: k("table", "table") }, [
            el("thead", {}, [el("tr", {}, b.head.map((c, i) => cell("th", c, i)))]),
            el("tbody", {}, b.rows.map((r) => el("tr", {}, r.map((c, i) => cell("td", c, i))))),
          ]),
        ];
      }
      case "thematicBreak":
        return [el("hr", { class: k("hr", "thematicBreak") })];
      case "footnoteDef":
        return [];
      case "custom":
        return [custom("block", b.name, b.data, blocks(b.children))];
    }
  };

  const out = blocks(doc.children);
  if (fns.length) {
    out.push(
      el("section", { class: k("footnotes", "footnoteDef") }, [
        el(
          "ol",
          { class: k("footnote-list") },
          fns.map((f) => {
            const id = fnId(f.label);
            const kids = blocks(f.children);
            const back = el("a", { href: "#fnref-" + id, class: k("footnote-back"), "aria-label": "Back to content" }, ["↩"]);
            const last = kids[kids.length - 1];
            if (last && typeof last === "object" && "t" in last && last.t === "p") last.c.push(" ", back);
            else kids.push(back);
            return el("li", { id: "fn-" + id, class: k("footnote") }, kids);
          }),
        ),
      ]),
    );
  }
  return out;
}

function ser(v: VN): string {
  if (typeof v === "string") return escH(v);
  if ("raw" in v) return v.raw;
  if ("el" in v) return String(v.el.outerHTML ?? "");
  let s = "<" + v.t;
  for (const n in v.a) s += ` ${n}="${escH(v.a[n])}"`;
  return VOID.has(v.t) ? s + ">" : s + ">" + v.c.map(ser).join("") + "</" + v.t + ">";
}

function build(v: VN, d: Document): Node {
  if (typeof v === "string") return d.createTextNode(v);
  if ("raw" in v) {
    const t = d.createElement("template");
    t.innerHTML = v.raw; // trusted markup from highlight / mathRenderer only
    return t.content;
  }
  if ("el" in v) return v.el;
  const e = d.createElement(v.t);
  for (const n in v.a) e.setAttribute(n, v.a[n]);
  for (const c of v.c) e.appendChild(build(c, d));
  return e;
}

const asDoc = (doc: Doc | string, o: RenderOptions): Doc => (typeof doc === "string" ? parse(doc, o) : doc);

/** Server-safe: pure string output, every text and attribute value escaped. */
export function renderHtml(doc: Doc | string, opts: RenderOptions = {}): string {
  return toVN(asDoc(doc, opts), opts).map(ser).join("");
}

/** Builds DOM with createElement/textContent; user text never goes through innerHTML. */
export function renderDom(doc: Doc | string, opts: RenderOptions = {}, document?: Document): DocumentFragment {
  const d = document ?? globalThis.document;
  const f = d.createDocumentFragment();
  for (const v of toVN(asDoc(doc, opts), opts)) f.appendChild(build(v, d));
  return f;
}

export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  return renderHtml(parse(md, opts), opts);
}

export { inlineToText };
