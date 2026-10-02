import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser";
import { renderDom } from "../../../src/render";
import { chipKey, chipMarkdown, chipOfElement, cleanAttrs, escapeChipText, wireForTextarea } from "../../../src/extensions/chips/wire";
import { measureScaling, LINEAR_MAX_RATIO } from "../../helpers/scaling";
import type { InlineNode } from "../../../src/types";

type Chip = Extract<InlineNode, { type: "chip" }>;
const firstChip = (md: string, schemes = ["tag", "task"]): Chip | undefined => {
  const p = parse(md, { chipSchemes: schemes }).children[0];
  return p && p.type === "paragraph" ? (p.children.find((n) => n.type === "chip") as Chip | undefined) : undefined;
};

describe("chipMarkdown: the wire text", () => {
  it("is [trigger+label](scheme:kind/id?refs) and parses back to the same chip", () => {
    const md = chipMarkdown({ scheme: "mention", kind: "person", id: "u1", label: "Jane Doe", trigger: "@", attrs: { crm: "12 3" } });
    expect(md).toBe("[@Jane Doe](mention:person/u1?crm=12%203)");
    expect(firstChip(md)).toEqual({ type: "chip", scheme: "mention", kind: "person", id: "u1", label: "Jane Doe", trigger: "@", attrs: { crm: "12 3" } });
  });

  const labels = [
    "a[b]c",
    "back\\slash",
    "end\\",
    "*star* _under_ snake_case",
    "`tick`",
    "~~gone~~",
    "<http://x.y>",
    "&amp; &copy;",
    "pipe | bar",
    "$5 and $6",
    "http://example.com www.example.com",
    "![img]",
    "](javascript:alert(1))",
    "日本語 名前",
    "a​b‮c",
  ];
  for (const label of labels) {
    it(`escapes ${JSON.stringify(label)} exactly as stringify does`, () => {
      const chip = { scheme: "tag", kind: "", id: "x", label, trigger: "#" };
      const mine = chipMarkdown(chip, { dollars: (label.split("$").length - 1) >= 1 && (label + "#").split("$").length - 1 >= 2 });
      const back = firstChip(mine);
      expect(back?.label).toBe(label);
      expect(back?.id).toBe("x");
      // stringify of the same chip as a paragraph is the same text, and it is a fixed point.
      const doc = { type: "doc" as const, children: [{ type: "paragraph" as const, children: [{ type: "chip" as const, ...chip }] }] };
      const theirs = stringify(doc, { chipSchemes: ["tag"] }).trim();
      expect(mine).toBe(theirs);
      expect(stringify(parse(mine, { chipSchemes: ["tag"] }), { chipSchemes: ["tag"] }).trim()).toBe(mine);
    });
  }

  it("line breaks in a label become spaces", () => {
    expect(firstChip(chipMarkdown({ scheme: "tag", kind: "", id: "a", label: "a\nb", trigger: "#" }))?.label).toBe("a b");
  });

  it("escapes the openers of custom inline syntax", () => {
    expect(escapeChipText("a==b==", { opens: ["=="] })).toBe("a\\==b\\==");
  });

  it("is linear on a huge hostile label", () => {
    const r = measureScaling((n) => {
      const s = "[\\_*<&$|".repeat(n);
      return () => void escapeChipText(s, { pipes: true, dollars: true });
    }, 2000);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});

describe("wireForTextarea", () => {
  const chip = { scheme: "mention", kind: "", id: "u", label: "A|B $x", trigger: "@" };
  it("escapes | inside a table row and $ when the line has another dollar", () => {
    const v = "| a | @q | $1 |";
    const s = v.indexOf("@q");
    const w = wireForTextarea(v, s, s + 2, chip);
    expect(w.text).toBe("[@A\\|B \\$x](mention:u)");
  });
  it("takes a ! before the link in so it never becomes an image", () => {
    const v = "wow!@q";
    const w = wireForTextarea(v, 4, 6, { ...chip, label: "Ann" });
    expect(w.from).toBe(3);
    expect(w.text).toBe("\\![@Ann](mention:u)");
    const md = v.slice(0, w.from) + w.text;
    expect(firstChip(md)?.label).toBe("Ann");
  });
});

describe("chipOfElement", () => {
  it("reads a rendered chip (badge and decorations excluded)", () => {
    const frag = renderDom("[@Jane](mention:person/u1?crm=9)", { chips: [{ scheme: "mention", kinds: { person: { label: "Team" } } }] });
    const host = document.createElement("div");
    host.append(frag);
    const el = host.querySelector(".atm-chip")!;
    const deco = document.createElement("span");
    deco.setAttribute("data-atm-chip-decor", "lead");
    deco.textContent = "ICON";
    el.prepend(deco);
    expect(chipOfElement(el)).toEqual({ type: "chip", scheme: "mention", kind: "person", id: "u1", label: "Jane", trigger: "@", attrs: { crm: "9" } });
  });
  it("ignores __proto__ and non-string refs", () => {
    const el = document.createElement("span");
    el.setAttribute("data-scheme", "mention");
    el.setAttribute("data-id", "x");
    el.setAttribute("data-refs", '{"__proto__":{"polluted":"1"},"constructor":"x","n":1,"ok":"y"}');
    const c = chipOfElement(el);
    expect(c.attrs).toEqual({ ok: "y" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("cleanAttrs and chipKey", () => {
    expect(cleanAttrs(null)).toBeUndefined();
    expect(cleanAttrs(["a"])).toBeUndefined();
    expect(chipKey({ scheme: "m", id: "1" })).toBe("m::1");
  });
});
