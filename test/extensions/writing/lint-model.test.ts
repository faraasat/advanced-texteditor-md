import { describe, expect, it } from "vitest";
import { collectText, offsetOf, rangeFor, remapIssues, sanitizeIssues, OBJ } from "../../../src/extensions/writing/lint-model";
import { expectLinear } from "./linear";

const dom = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
};

describe("collectText: the lint text model", () => {
  it("one run per block, joined by a line break, across inline formatting", () => {
    const m = collectText(dom("<h1>Title</h1><p>Some <strong>bold</strong> text</p><ul><li>one</li><li>two</li></ul>"), false);
    expect(m.text).toBe("Title\nSome bold text\none\ntwo");
    expect(m.blocks).toEqual([
      { text: "Title", offset: 0 },
      { text: "Some bold text", offset: 6 },
      { text: "one", offset: 21 },
      { text: "two", offset: 25 },
    ]);
  });

  it("an atom is one object character; a <br> a line break; code blocks skipped unless asked", () => {
    const html = `<p>Hi <span class="atm-chip" contenteditable="false">@Ann</span> there<br>next</p><pre><code>let x</code></pre><p>a <code>b</code> c</p>`;
    expect(collectText(dom(html), false).text).toBe(`Hi ${OBJ} there\nnext\na ${OBJ} c`);
    expect(collectText(dom(html), true).text).toBe(`Hi ${OBJ} there\nnext\nlet x\na b c`);
  });

  it("decorations marked as not content are not text", () => {
    const html = `<p>Keep</p><div contenteditable="false" data-atm-preview-card="">Card text</div><p>this</p>`;
    expect(collectText(dom(html), false).text).toBe("Keep\nthis");
  });

  it("maps offsets to DOM ranges and back", () => {
    const root = dom("<p>Some <em>very</em> long</p><p>Second line</p>");
    const m = collectText(root, false);
    const r = rangeFor(m, 5, 9, document)!;
    expect(r.toString()).toBe("very");
    const r2 = rangeFor(m, 3, 12, document)!;
    expect(r2.toString()).toBe("e very lo");
    const cross = rangeFor(m, 10, 21, document)!;
    expect(cross.toString().replace(/\s+/g, " ")).toContain("long");
    const sec = root.querySelectorAll("p")[1].firstChild!;
    expect(offsetOf(m, sec, 3)).toBe(m.text.indexOf("Second") + 3);
    expect(rangeFor(m, -1, 3, document)).toBeNull();
    expect(rangeFor(m, 2, 999, document)).toBeNull();
    expect(rangeFor(m, Number.NaN, 2, document)).toBeNull();
  });

  it("an offset inside an atom snaps to the text beside it", () => {
    const root = dom(`<p>ab<span class="atm-chip" contenteditable="false">X</span>cd</p>`);
    const m = collectText(root, false);
    expect(m.text).toBe(`ab${OBJ}cd`);
    expect(rangeFor(m, 1, 4, document)!.toString()).toBe("bXc");
  });
});

describe("sanitizeIssues", () => {
  it("drops malformed issues, clamps offsets, defaults severity, keeps fixes as strings", () => {
    const out = sanitizeIssues(
      [
        { from: 0, to: 3, message: "ok" },
        { from: -5, to: 2, message: "clamped" },
        { from: 2, to: 1e9, message: "end clamped", severity: "error" },
        { from: Number.NaN, to: 2, message: "nan" },
        { from: 4, to: 4, message: "empty" },
        { from: 5, to: 2, message: "reversed" },
        { from: "1", to: 2, message: "string offset" },
        null,
        "junk",
        { from: 1, to: 2, message: { toString: () => "x" } },
        { from: 1, to: 2, message: "sev", severity: "fatal", fixes: [{ label: "A", replacement: "b" }, { label: 1, replacement: "c" }, null] },
      ],
      10,
    );
    expect(out.map((i) => i.message)).toEqual(["clamped", "ok", "sev", "end clamped"]);
    expect(out[0]).toMatchObject({ from: 0, to: 2 });
    expect(out[3]).toMatchObject({ from: 2, to: 10, severity: "error" });
    expect(out[2].severity).toBe("warning");
    expect(out[2].fixes).toEqual([{ label: "A", replacement: "b" }]);
    expect(sanitizeIssues("nope", 10)).toEqual([]);
    expect(sanitizeIssues(undefined, 10)).toEqual([]);
  });

  it("strips bidi controls from messages and labels, caps the count", () => {
    const [i] = sanitizeIssues([{ from: 0, to: 1, message: "a\u202eb", fixes: [{ label: "x\u2066y", replacement: "z" }] }], 5);
    expect(i.message).toBe("ab");
    expect(i.fixes[0].label).toBe("xy");
    const many = Array.from({ length: 5000 }, (_, k) => ({ from: k % 10, to: (k % 10) + 1, message: "m" }));
    expect(sanitizeIssues(many, 20, 100)).toHaveLength(100);
  });
});

describe("remapIssues", () => {
  const I = (from: number, to: number) => ({ from, to, message: "", severity: "warning" as const, fixes: [] });
  it("keeps issues before an edit, shifts issues after it, drops issues it touched", () => {
    const old = "teh cat sat on teh mat";
    const now = "teh big cat sat on teh mat"; // inserted "big " at 4
    const out = remapIssues([I(0, 3), I(4, 7), I(15, 18)], old, now);
    expect(out).toEqual([I(0, 3), I(8, 11), I(19, 22)]);
    const del = remapIssues([I(0, 3), I(4, 7), I(15, 18)], old, "teh at on teh mat");
    expect(del.map((i) => [i.from, i.to])).toEqual([[0, 3], [10, 13]]);
  });
  it("is linear", () => {
    expectLinear((n) => {
      const a = "word ".repeat(n);
      const b = a.slice(0, n) + "X" + a.slice(n);
      const issues = Array.from({ length: n / 10 }, (_, k) => I(k * 50, k * 50 + 4));
      return () => remapIssues(issues, a, b);
    }, 20_000);
  });
});
