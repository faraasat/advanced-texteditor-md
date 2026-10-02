/**
 * Markdown input rules. Each rule fires after the user typed its trigger
 * character, and is ONE history step: the literal characters are recorded
 * first (ctx.begin() flushes typing), then the transformation is committed,
 * so Mod-z right after a rule brings the typed characters back.
 */
import type { InlineNode } from "../../types";
import type { Ctx } from "./ctx";
import { parse } from "../../parser/index";
import { domInline } from "../dom-to-doc";
import { inlineToText } from "../../parser/index";
import { caretAt, closest, emptyP, isItem, itemOf, leafOf, makeTask, mk, rename, tidyLeaf } from "./dom";
import { placeAfter, setTask } from "./structure";
import { getCommand } from "../commands";
import { indexOf, isText, leafOffset, lengthOf, offsetOf, setSelection } from "../selection";

type InlineRule = {
  name: string;
  /** Last character of the closer. */
  last: string;
  re: RegExp;
  feature?: string;
  build(ctx: Ctx, m: RegExpExecArray): Node | null;
  /** The next typed text must not continue inside the new element. */
  exit?: boolean;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

function markEl(ctx: Ctx, tag: string, text: string): Node {
  const e = mk(ctx, tag);
  e.textContent = text;
  return e;
}

function builtinRules(): InlineRule[] {
  return [
    { name: "bold", last: "*", feature: "bold", re: /(?:^|[^*\\])(\*\*([^*\s](?:[^*]*?[^*\s])?)\*\*)$/, build: (c, m) => markEl(c, "STRONG", m[2]), exit: true },
    { name: "bold", last: "_", feature: "bold", re: /(?:^|[^\w\\])(__([^_\s](?:[^_]*?[^_\s])?)__)$/, build: (c, m) => markEl(c, "STRONG", m[2]), exit: true },
    { name: "italic", last: "*", feature: "italic", re: /(?:^|[^*\\])(\*([^*\s](?:[^*]*?[^*\s])?)\*)$/, build: (c, m) => markEl(c, "EM", m[2]), exit: true },
    { name: "italic", last: "_", feature: "italic", re: /(?:^|[^\w\\_])(_([^_\s](?:[^_]*?[^_\s])?)_)$/, build: (c, m) => markEl(c, "EM", m[2]), exit: true },
    { name: "strike", last: "~", feature: "strike", re: /(?:^|[^~\\])(~~([^~\s](?:[^~]*?[^~\s])?)~~)$/, build: (c, m) => markEl(c, "DEL", m[2]), exit: true },
    { name: "code", last: "`", feature: "code", re: /(?:^|[^`\\])(`([^`]+)`)$/, build: (c, m) => markEl(c, "CODE", m[2]), exit: true },
    {
      name: "math",
      last: "$",
      feature: "math",
      re: /(?:^|[^$\\])(\$([^$\s](?:[^$]*?[^$\s])?)\$)$/,
      build: (c, m) => c.inline([{ type: "math", tex: m[2] }])[0] ?? null,
    },
    {
      name: "image",
      last: ")",
      feature: "images",
      re: /(!\[([^\]\n]*)\]\(([^)\s]+)\))$/,
      build: (c, m) => c.inline([{ type: "image", src: m[3], alt: m[2] }])[0] ?? null,
    },
    {
      name: "link",
      last: ")",
      feature: "links",
      re: /(?:^|[^!\\])(\[([^\]\n]+)\]\(([^)\s]+)\))$/,
      build: (c, m) => c.inline([{ type: "link", href: m[3], children: [{ type: "text", value: m[2] }] }])[0] ?? null,
      exit: true,
    },
  ];
}

function customRules(ctx: Ctx): InlineRule[] {
  const out: InlineRule[] = [];
  for (const sy of ctx.opts.render.syntax?.inline ?? []) {
    if (!sy.open) continue;
    const close = sy.close ?? sy.open;
    const o = esc(sy.open);
    const c = esc(close);
    const same = close === sy.open;
    const ch = esc(sy.open[0]);
    const re = same
      ? new RegExp(`(?:^|[^${ch}\\\\])(${o}([^\\s${ch}](?:[^${ch}]*?[^\\s${ch}])?)${c})$`)
      : new RegExp(`(?:^|[^\\\\])(${o}([^\\n]+?)${c})$`);
    out.push({
      name: "custom:" + sy.name,
      last: close[close.length - 1],
      re,
      build: (cx, m) => {
        const kids: InlineNode[] = sy.nested === false ? [{ type: "text", value: m[2] }] : (firstInline(m[2], cx) ?? [{ type: "text", value: m[2] }]);
        return cx.inline([{ type: "custom", name: sy.name, children: kids }])[0] ?? null;
      },
      exit: true,
    });
  }
  return out;
}

function firstInline(md: string, ctx: Ctx): InlineNode[] | null {
  const d = parse(md, ctx.parseOpts);
  const b = d.children[0];
  return d.children.length === 1 && b.type === "paragraph" ? b.children : null;
}

/** Called after an `input` event of type insertText. Returns true when a rule fired. */
export function inlineRule(ctx: Ctx, typed: string): boolean {
  if (!typed) return false;
  const ch = typed[typed.length - 1];
  const r = ctx.range();
  if (!r || !r.collapsed || !isText(r.startContainer)) return false;
  const t = r.startContainer as Text;
  const off = r.startOffset;
  const leaf = leafOf(ctx.root, t);
  if (!leaf || leaf.tagName === "PRE" || leaf.tagName === "SUMMARY" || ctx.mathEditing()) return false;
  if (closest(ctx, t, (e) => e.tagName === "CODE")) return false;
  if (ch === " " && autolink(ctx, t, off - 1)) return true;
  const before = t.data.slice(0, off);
  const rules = [...customRules(ctx), ...builtinRules()];
  for (const rule of rules) {
    if (rule.last !== ch) continue;
    if (rule.feature && !ctx.feature(rule.feature)) continue;
    if ((rule.name === "link" || rule.name === "image") && closest(ctx, t, (e) => e.tagName === "A")) continue;
    const m = rule.re.exec(before);
    if (!m) continue;
    const full = m[1];
    const start = before.length - full.length;
    const fullLen = full.length;
    const el = rule.build(ctx, m);
    if (!el) continue;
    ctx.begin();
    ctx.snapshot();
    const mid = t.splitText(start);
    mid.splitText(fullLen);
    mid.replaceWith(el);
    const parent = el.parentNode!;
    const after = el.nextSibling;
    if (after && isText(after)) setSelection(ctx.root, { node: after, offset: 0 });
    else setSelection(ctx.root, { node: parent, offset: indexOf(el) + 1 });
    if (rule.exit && el.nodeType === 1) {
      ctx.pending.exit = el as HTMLElement;
      ctx.pending.at = ctx.save()?.anchor ?? -1;
    }
    ctx.commit("rule");
    return true;
  }
  return false;
}

const URL_RE = /(?:^|[\s(])((?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?'")\]*_~])$/i;

/** Bare URL followed by a space or Enter becomes a link. `end` is where the URL ends in `t`. */
export function autolink(ctx: Ctx, t: Text, end: number): boolean {
  if (!ctx.feature("autolink") || !ctx.feature("links")) return false;
  if (closest(ctx, t, (e) => e.tagName === "A" || e.tagName === "CODE")) return false;
  const before = t.data.slice(0, end);
  const m = URL_RE.exec(before);
  if (!m) return false;
  const url = m[1];
  if (/^www\.$/i.test(url) || /^https?:\/\/$/i.test(url)) return false;
  const href = /^www\./i.test(url) ? "http://" + url : url;
  const el = ctx.inline([{ type: "link", href, children: [{ type: "text", value: url }] }])[0];
  if (!el) return false;
  const sel = ctx.save();
  ctx.begin();
    ctx.snapshot();
  const start = end - url.length;
  const mid = t.splitText(start);
  mid.splitText(url.length);
  mid.replaceWith(el);
  ctx.restore(sel);
  ctx.commit("rule");
  return true;
}

/** Block rules typed at the start of a paragraph, triggered by a space. */
export function spaceRule(ctx: Ctx): boolean {
  const r = ctx.range();
  if (!r || !r.collapsed || !isText(r.startContainer)) return false;
  const t = r.startContainer as Text;
  const leaf = leafOf(ctx.root, t);
  if (!leaf || leaf.tagName !== "P" || ctx.mathEditing()) return false;
  if (offsetOf(leaf, t, 0) !== 0 || leafOffset(leaf, t, r.startOffset) !== r.startOffset) return false;
  const before = t.data.slice(0, r.startOffset);
  const inItem = !!itemOf(ctx, leaf) && isItem(ctx, leaf.parentElement);
  let m: RegExpExecArray | null;
  const strip = () => {
    t.deleteData(0, before.length);
    tidyLeaf(leaf);
  };
  if ((m = /^(#{1,6}) $/.exec(before))) {
    const cmd = "heading:" + m[1].length;
    if (!ctx.feature("headings:" + m[1].length)) return false;
    ctx.begin();
    ctx.snapshot();
    strip();
    caretAt(ctx, leaf, 0);
    const h = rename(ctx, leaf, "H" + m[1].length);
    tidyLeaf(h);
    caretAt(ctx, h, 0);
    void cmd;
    ctx.commit("rule");
    return true;
  }
  if ((m = /^(?:[-*+] )?\[( |x|X)?\] $/.exec(before)) && ctx.feature("taskLists")) {
    const checked = !!m[1] && m[1] !== " ";
    ctx.begin();
    ctx.snapshot();
    strip();
    caretAt(ctx, leaf, 0);
    if (inItem) makeTask(ctx, leaf.parentElement as HTMLElement, checked);
    else {
      getCommand(ctx, "taskList")!.run();
      const li = itemOf(ctx, leaf);
      if (li && checked) setTask(ctx, li, true);
    }
    caretAt(ctx, leaf, 0);
    ctx.commit("rule");
    return true;
  }
  if (inItem) return false;
  if (/^[-*+] $/.test(before) && ctx.feature("lists")) {
    ctx.begin();
    ctx.snapshot();
    strip();
    caretAt(ctx, leaf, 0);
    getCommand(ctx, "bulletList")!.run();
    caretAt(ctx, leaf, 0);
    ctx.commit("rule");
    return true;
  }
  if ((m = /^(\d{1,9})[.)] $/.exec(before)) && ctx.feature("lists")) {
    const start = Number(m[1]);
    ctx.begin();
    ctx.snapshot();
    strip();
    caretAt(ctx, leaf, 0);
    getCommand(ctx, "orderedList")!.run();
    const li = itemOf(ctx, leaf);
    if (li && start !== 1) li.parentElement!.setAttribute("start", String(start));
    caretAt(ctx, leaf, 0);
    ctx.commit("rule");
    return true;
  }
  if (before === "> " && ctx.feature("blockquote")) {
    ctx.begin();
    ctx.snapshot();
    strip();
    const q = mk(ctx, "BLOCKQUOTE");
    leaf.before(q);
    q.appendChild(leaf);
    caretAt(ctx, leaf, 0);
    ctx.commit("rule");
    return true;
  }
  return false;
}

/** Block rules completed by Enter on a paragraph: ``` --- $$ | a | b |. */
export function enterRule(ctx: Ctx): boolean {
  const r = ctx.range();
  if (!r || !r.collapsed) return false;
  const leaf = leafOf(ctx.root, r.startContainer);
  if (!leaf || leaf.tagName !== "P" || ctx.mathEditing()) return false;
  if (leafOffset(leaf, r.startContainer, r.startOffset) !== lengthOf(leaf)) return false;
  const text = inlineToText(domInline(leaf.childNodes, ctx.dtd));
  const raw = leaf.textContent ?? "";
  let m: RegExpExecArray | null;
  if ((m = /^(```|~~~)[ \t]*([^`\s]*)[ \t]*$/.exec(raw)) && ctx.feature("codeBlocks")) {
    ctx.begin();
    ctx.snapshot();
    const [pre] = ctx.blocks([{ type: "codeBlock", lang: m[2], code: "", fence: m[1] === "~~~" ? "~~~" : "```" }]);
    leaf.replaceWith(pre);
    caretAt(ctx, pre, 0);
    ctx.commit("rule");
    return true;
  }
  if (/^(?:---|\*\*\*|___)$/.test(raw) && ctx.feature("rule")) {
    ctx.begin();
    ctx.snapshot();
    const [hr] = ctx.blocks([{ type: "thematicBreak" }]);
    leaf.replaceWith(hr);
    placeAfter(ctx, hr);
    ctx.commit("rule");
    return true;
  }
  if (raw === "$$" && ctx.feature("math")) {
    ctx.begin();
    ctx.snapshot();
    const [el] = ctx.blocks([{ type: "math", tex: "" }]);
    leaf.replaceWith(el);
    if (!el.nextElementSibling) el.after(emptyP(ctx));
    ctx.openMathEdit(el);
    ctx.commit("rule");
    return true;
  }
  if ((m = /^\|(.+)\|[ \t]*$/.exec(text)) && ctx.feature("tables") && !itemOf(ctx, leaf)) {
    const cells = m[1].split(/(?<!\\)\|/).map((c) => c.trim());
    if (!cells.length) return false;
    ctx.begin();
    ctx.snapshot();
    const head = cells.map((c) => firstInline(c, ctx) ?? (c ? [{ type: "text", value: c } as InlineNode] : []));
    const [tb] = ctx.blocks([{ type: "table", align: cells.map(() => null), head, rows: [cells.map(() => [])] }]);
    leaf.replaceWith(tb);
    if (!tb.nextElementSibling) tb.after(emptyP(ctx));
    const first = tb.querySelector("tbody td") as HTMLElement | null;
    if (first) caretAt(ctx, first, 0);
    ctx.commit("rule");
    return true;
  }
  // Autolink a URL ending the line.
  const last = r.startContainer;
  if (isText(last) && autolink(ctx, last, r.startOffset)) return false;
  return false;
}
