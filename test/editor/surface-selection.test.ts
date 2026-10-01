import { describe, expect, it } from "vitest";
import { fromPath, lengthOf, offsetOf, pointAt, toPath } from "../../src/editor/selection";

const html = (s: string) => {
  const d = document.createElement("div");
  d.innerHTML = s;
  return d;
};

describe("linear selection model", () => {
  it("counts text, atoms and one per block boundary", () => {
    const d = html('<p>ab<strong>cd</strong></p><p><span contenteditable="false">@x</span>e</p><ul><li><p>f</p></li></ul>');
    // ab cd | @ e | f   → 4 + 1 + 2 + 1 + 1
    expect(lengthOf(d)).toBe(9);
    const e = d.querySelectorAll("p")[1].lastChild!;
    expect(offsetOf(d, e, 0)).toBe(6);
    expect(offsetOf(d, e, 1)).toBe(7);
    const p = pointAt(d, 6);
    expect(p.node).toBe(e);
    expect(p.offset).toBe(0);
  });

  it("a trailing <br> placeholder counts 0, an inner <br> counts 1", () => {
    const d = html("<p><br></p><p>a<br>b</p><p>c<br><br></p>");
    expect(lengthOf(d)).toBe(0 + 1 + 3 + 1 + 2);
    const p = pointAt(d, 0);
    expect(p.node).toBe(d.firstChild);
  });

  it("round-trips every point of a mixed document", () => {
    const d = html('<h1>T<em>i</em></h1><blockquote><p>q</p></blockquote><table><tbody><tr><td>1</td><td><br></td></tr></tbody></table><pre><code>a\nb</code></pre><p>z</p>');
    const n = lengthOf(d);
    for (let i = 0; i <= n; i++) {
      const pt = pointAt(d, i);
      expect(offsetOf(d, pt.node, pt.offset)).toBe(i);
    }
  });

  it("paths are [block, offset] and survive a structure change", () => {
    const d = html("<p>one</p><p>two</p>");
    const path = toPath(d, 6);
    expect(path).toEqual([1, 2]);
    d.innerHTML = "<ul><li><p>one</p></li><li><p>two</p></li></ul>";
    expect(fromPath(d, [0, 6])).toBe(6);
  });

  it("points inside atoms map to their edges", () => {
    const d = html('<p>a<span contenteditable="false">chip</span>b</p>');
    const chipText = d.querySelector("span")!.firstChild!;
    expect(offsetOf(d, chipText, 0)).toBe(1);
    expect(offsetOf(d, chipText, 2)).toBe(2);
  });
});
