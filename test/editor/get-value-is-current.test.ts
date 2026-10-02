import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "../../src/editor/create-editor";

const hosts: HTMLElement[] = [];
const eds: { destroy(): void }[] = [];
function make(value: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const ed = createEditor(host, { value });
  eds.push(ed);
  return { ed, editable: host.querySelector<HTMLElement>("[contenteditable]")! };
}
afterEach(() => {
  while (eds.length) eds.pop()!.destroy();
  while (hosts.length) hosts.pop()!.remove();
});
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const type = (editable: HTMLElement, text: string) => {
  const t = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT).nextNode() as Text;
  t.data += text;
  const r = document.createRange();
  r.setStart(t, t.data.length);
  r.collapse(true);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(r);
  editable.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
};

describe("getValue is always current", () => {
  it("a legacy plain-text description comes back verbatim after setValue, and stays so", async () => {
    const legacy = ["Call back  tomorrow\nbring the quote  ", "  indented text\n- not a list?\n1) x", "a_b_c *star* <b>tag</b> & more", "line one\nline two\n\n\n\nline three", "trailing space "];
    for (const text of legacy) {
      const { ed } = make("");
      ed.setValue(text);
      expect(ed.getValue()).toBe(text);
      await wait(20);
      expect(ed.getValue()).toBe(text);
    }
  });
  it("a verbatim value survives wysiwyg -> markdown -> wysiwyg untouched", () => {
    const odd = "Title\n=====\n\n*  odd   spacing  *\n\n\n\n- a\n* b\n\n1) x\n";
    const { ed } = make(odd);
    ed.setMode("markdown");
    expect(ed.getValue()).toBe(odd);
    ed.setMode("wysiwyg");
    expect(ed.getValue()).toBe(odd);
  });
  it("a document over 20 kB reports the last keystroke at once", () => {
    const big = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} lorem ipsum dolor sit amet, consectetur adipiscing.`).join("\n\n");
    expect(big.length).toBeGreaterThan(20000);
    const { ed, editable } = make(big);
    type(editable, "ZZ");
    expect(ed.getValue().startsWith("Paragraph 0 lorem ipsum dolor sit amet, consectetur adipiscing.ZZ")).toBe(true);
  });
  it("typing in a big document still defers the serialisation (flush only when asked)", async () => {
    const big = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} lorem ipsum dolor sit amet, consectetur adipiscing.`).join("\n\n");
    const { ed, editable } = make(big);
    let inputs = 0;
    ed.on("input", () => inputs++);
    type(editable, "a");
    type(editable, "b");
    type(editable, "c");
    await wait(0);
    expect(inputs).toBe(0);
    expect(ed.getValue()).toContain("adipiscing.abc");
  });
});
