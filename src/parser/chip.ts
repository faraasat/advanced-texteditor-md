import type { InlineNode } from "../types";
import { inlineToText } from "./util";

type Chip = Extract<InlineNode, { type: "chip" }>;

const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** `scheme:kind/id?k=v` or `scheme:id`; every part percent-decoded. */
export function parseChip(scheme: string, rest: string, kids: InlineNode[]): Chip {
  const qi = rest.indexOf("?");
  const path = qi < 0 ? rest : rest.slice(0, qi);
  const si = path.indexOf("/");
  const text = inlineToText(kids);
  const first = text ? String.fromCodePoint(text.codePointAt(0)!) : "";
  const trig = first && /^[^\p{L}\p{N}\s]$/u.test(first) ? first : "";
  const chip: Chip = {
    type: "chip",
    scheme,
    kind: si < 0 ? "" : dec(path.slice(0, si)),
    id: dec(si < 0 ? path : path.slice(si + 1)),
    label: text.slice(trig.length),
  };
  if (trig) chip.trigger = trig;
  if (qi >= 0) {
    const attrs: Record<string, string> = {};
    for (const p of rest.slice(qi + 1).split("&")) {
      if (!p) continue;
      const e = p.indexOf("=");
      attrs[dec(e < 0 ? p : p.slice(0, e))] = e < 0 ? "" : dec(p.slice(e + 1));
    }
    if (Object.keys(attrs).length) chip.attrs = attrs;
  }
  return chip;
}

export function enc(s: string): string {
  let e: string;
  try {
    e = encodeURIComponent(s);
  } catch {
    e = encodeURIComponent(s.replace(/[\ud800-\udfff]/g, "\ufffd"));
  }
  return e.replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export function chipHref(c: Chip): string {
  const q = c.attrs ? Object.entries(c.attrs) : [];
  return (
    `${c.scheme}:${c.kind ? enc(c.kind) + "/" : ""}${enc(c.id)}` +
    (q.length ? "?" + q.map(([k, v]) => enc(k) + "=" + enc(v)).join("&") : "")
  );
}
