/**
 * Markup a host has vouched for (`trust`) is still stripped of what runs or navigates: scripts,
 * frames and objects, `on*` attributes, `javascript:` / `vbscript:` / non-image `data:` URLs,
 * animation of an `href` or event attribute, `<meta>` / `<base>` / `<link>`, `@import` and CSS
 * expressions. It is parsed through an inert `<template>`; nothing is ever assigned with innerHTML
 * on a live element. This is hygiene for a renderer you chose, not a sandbox for one you did not:
 * untrusted strings go into a sandboxed iframe instead.
 */
const DROP = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "link", "meta", "portal", "noscript", "template"]);
const ANIMATE = new Set(["set", "animate", "animatetransform", "animatemotion"]);
const URL_ATTRS = new Set(["href", "xlink:href", "src", "srcset", "action", "formaction", "data", "poster", "background", "ping", "cite", "codebase", "manifest", "longdesc", "usemap", "from", "to", "values"]);
const INERT_CHARS = new RegExp("[" + ["\\u0000-\\u0020","\\u007f-\\u009f","\\u00ad","\\u200b-\\u200f","\\u2028-\\u202f","\\u2060","\\ufeff"].join("") + "]", "g");
const BAD_CSS = /@import|expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/i;

function badUrl(v: string): boolean {
  const u = v.replace(INERT_CHARS, "").toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(u);
  if (!m) return false;
  if (m[1] === "data") return !/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/.test(u);
  return m[1] === "javascript" || m[1] === "vbscript" || m[1] === "livescript" || m[1] === "mocha";
}

/** Parse `markup` (inert) and return a clean fragment owned by `doc`. */
export function sanitizeMarkup(markup: string, doc: Document): DocumentFragment {
  const tpl = doc.createElement("template");
  tpl.innerHTML = String(markup);
  const frag = tpl.content;
  const drop: Element[] = [];
  const all = frag.querySelectorAll("*");
  for (let k = 0; k < all.length; k++) {
    const el = all[k];
    const name = el.localName.toLowerCase();
    if (DROP.has(name)) {
      drop.push(el);
      continue;
    }
    if (ANIMATE.has(name) && /^(on|(xlink:)?href$)/i.test(el.getAttribute("attributeName") ?? "")) {
      drop.push(el);
      continue;
    }
    if (name === "style" && BAD_CSS.test(el.textContent ?? "")) {
      drop.push(el);
      continue;
    }
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "srcdoc") el.removeAttribute(a.name);
      else if (URL_ATTRS.has(n) && badUrl(a.value)) el.removeAttribute(a.name);
      else if (n === "style" && BAD_CSS.test(a.value)) el.removeAttribute(a.name);
    }
  }
  for (const el of drop) el.remove();
  return doc.importNode(frag, true);
}
