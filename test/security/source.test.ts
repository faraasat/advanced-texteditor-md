import { afterEach, describe, expect, it } from "vitest";
import { createSourcePanePlugin, duplicateLines, indentLines, lineStates, moveLines, pairAction, tintLine } from "../../src/extensions/source";
import { MARKDOWN } from "./vectors";
import { measureScaling, LINEAR_MAX_RATIO } from "../helpers/scaling";
import { mount, textareaReady, tick, type Mounted } from "../plugins/helpers";

const X = "window.__xss=1";
let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
});

const HOSTILE = [
  ...MARKDOWN.slice(0, 40),
  `<img src=x onerror=${X}>`,
  `[a](javascript:${X}) ![i](javascript:${X}) <script>${X}</script>`,
  "```<img src=x onerror=window.__xss=1>\n<svg onload=window.__xss=1>\n```",
  "---\n<b onclick=x>k</b>: <i>v</i>\n---",
  "$$ </script><img src=x onerror=window.__xss=1> $$",
  "| <iframe src=javascript:window.__xss=1> | b |\n|---|---|",
  "‮evil‬ \u0000 ​ \ud800",
  "a".repeat(30000) + "**b**",
  "*".repeat(5000) + "x" + "_".repeat(5000),
  "[".repeat(3000) + "](".repeat(3000),
  "`".repeat(4000),
  Array.from({ length: 4000 }, (_, i) => `- [ ] task ${i} [@x](mention:person/${i})`).join("\n"),
];

/** Every element the layer holds is a div or a span with an `atm-` class; no attribute is an event or a URL. */
function unsafe(root: ParentNode): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((e) => {
    const tag = e.tagName;
    if (!["DIV", "SPAN", "BR"].includes(tag)) out.push(tag);
    for (const a of Array.from(e.attributes)) {
      if (a.name.startsWith("on")) out.push(`${tag}[${a.name}]`);
      if (["href", "src", "srcset", "action"].includes(a.name)) out.push(`${tag}[${a.name}]`);
      if (a.name === "style" && /url\(|javascript|expression|@import/i.test(a.value)) out.push(`${tag}[style]`);
    }
  });
  return out;
}

describe("source: hostile text in the tint layer", () => {
  for (const md of HOSTILE) {
    it(JSON.stringify(md.slice(0, 50)), async () => {
      (window as unknown as Record<string, unknown>).__xss = 0;
      m = mount({ value: md, mode: "markdown", plugins: [createSourcePanePlugin()] });
      const ta = await textareaReady(m);
      await tick();
      const layer = m.ed.element.querySelector(".atm-source-layer");
      expect(layer).not.toBeNull();
      expect(unsafe(layer!)).toEqual([]);
      // The layer is a copy for the eye: its text is the textarea's text, and the value is untouched.
      const shown = Array.from(layer!.querySelectorAll(".atm-src-line"))
        .map((l) => l.textContent)
        .join("\n");
      expect(shown.replace(/\r\n?/g, "\n")).toBe(ta.value.replace(/\r\n?/g, "\n"));
      expect(m.ed.getValue()).toBe(md);
      expect((window as unknown as Record<string, unknown>).__xss).toBe(0);
    });
  }
});

describe("source: the tokenizer and the line edits", () => {
  it("tokens are ranges of the line, in order, never overlapping outside their nesting", () => {
    for (const md of HOSTILE) {
      const states = lineStates(md.split("\n").slice(0, 300));
      md
        .split("\n")
        .slice(0, 300)
        .forEach((line, i) => {
          const t = tintLine(line, states[i]);
          let last = 0;
          for (const k of t.tokens) {
            expect(k.from).toBeGreaterThanOrEqual(last);
            expect(k.to).toBeGreaterThan(k.from);
            expect(k.to).toBeLessThanOrEqual(line.length);
            last = k.to;
          }
        });
    }
  });
  it("edits only ever replace the selected lines and keep the rest byte for byte", () => {
    const v = "a\n‮b\nc\n";
    for (const s of [{ value: v, start: 0, end: 0 }, { value: v, start: 1, end: 4 }, { value: v, start: v.length, end: v.length }]) {
      for (const e of [indentLines(s, 1), indentLines(s, -1), moveLines(s, 1), moveLines(s, -1), duplicateLines(s)]) {
        if (!e) continue;
        expect(e.from).toBeGreaterThanOrEqual(0);
        expect(e.to).toBeLessThanOrEqual(v.length);
        expect(e.from).toBeLessThanOrEqual(e.to);
      }
    }
  });
  it("pairing never pairs a quote inside a word or a closer it did not insert", () => {
    expect(pairAction({ value: "don", start: 3, end: 3 }, "'", false)).toBeNull();
    expect(pairAction({ value: "x)", start: 1, end: 1 }, ")", false)).toBeNull(); // not armed: the browser types it
    expect(pairAction({ value: "x)", start: 1, end: 1 }, ")", true)).toEqual({ move: 2 });
  });
});

describe("source: linear time", () => {
  const doc = (n: number) => Array.from({ length: n }, (_, i) => `## h${i} **b** \`c\` [l](u) ${"x".repeat(i % 40)}`);
  it("tinting every line is linear in the number of lines", () => {
    const r = measureScaling((n) => {
      const lines = doc(n);
      return () => {
        const st = lineStates(lines);
        lines.forEach((l, i) => tintLine(l, st[i]));
      };
    }, 500);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("one very long line is cut off, not scanned without end", () => {
    const r = measureScaling((n) => {
      const line = "*a ".repeat(n);
      return () => tintLine(line, "^");
    }, 5000);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});
