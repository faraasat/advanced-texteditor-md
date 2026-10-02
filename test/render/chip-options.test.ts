/**
 * `chips` takes the SAME two forms in `RenderOptions` and `EditorOptions`: an array of definitions
 * or a record keyed by scheme / `scheme:kind`. Normalised in one place (`chipTable`, parser/util.ts),
 * and a scheme named in `chips` is a chip scheme for the parser too (no `chipSchemes` needed).
 */
import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser";
import { renderDom, renderHtml } from "../../src/render";
import { chipTable } from "../../src/parser/util";
import { createEditor } from "../../src/editor/create-editor";

const md = "[Task 12](task:issue/12)";

describe("chips: array or record, one meaning", () => {
  it("repro: an ARRAY in renderHtml renders the chip with its class (and needs no chipSchemes)", () => {
    const html = renderHtml(md, { chips: [{ scheme: "task", className: "task-chip" }] });
    expect(html).toContain('class="atm-chip atm-chip-task atm-chip-kind-issue task-chip"');
    expect(html).toContain('data-scheme="task"');
    expect(html).not.toContain("<a ");
  });
  it("a RECORD keyed by scheme works the same, and also implies the scheme", () => {
    const a = renderHtml(md, { chips: [{ scheme: "task", className: "task-chip" }] });
    const b = renderHtml(md, { chips: { task: { scheme: "task", className: "task-chip" } } });
    expect(b).toBe(a);
  });
  it("a record key `scheme:kind` implies the scheme and wins over the scheme-wide entry", () => {
    const html = renderHtml(md, { chips: { "task:issue": { scheme: "task", className: "k" } } });
    expect(html).toContain("atm-chip-task");
    expect(html).toContain(" k\"");
    const both = renderHtml(md, { chips: { task: { scheme: "task", className: "s" }, "task:issue": { scheme: "task", className: "k" } } });
    expect(both).toContain(" k\"");
    expect(both).not.toContain(" s\"");
  });
  it("kinds in an array entry style the chip (colour slot and badge)", () => {
    const html = renderHtml(md, { chips: [{ scheme: "task", kinds: { issue: { color: 2, label: "Bug" } } }] });
    expect(html).toContain("--atm-chip-color:var(--atm-chip-2)");
    expect(html).toContain('<span class="atm-chip-badge">Bug</span>');
  });
  it("without chips or chipSchemes the scheme stays an ordinary (refused) link", () => {
    expect(renderHtml(md)).toBe('<p class="atm-p">Task 12</p>');
  });
  it("parse handed render options with chips recognises the scheme; stringify keeps the wire format", () => {
    const doc = parse(md, { chips: [{ scheme: "Task" }] } as never);
    expect(doc.children[0]).toMatchObject({ type: "paragraph", children: [{ type: "chip", scheme: "task", kind: "issue", id: "12", label: "Task 12" }] });
    expect(stringify(doc)).toBe(md);
  });
  it("renderDom agrees with renderHtml for both forms", () => {
    for (const chips of [[{ scheme: "task", className: "x" }], { task: { scheme: "task", className: "x" } }]) {
      const box = document.createElement("div");
      box.appendChild(renderDom(md, { chips }));
      expect(box.innerHTML).toBe(renderHtml(md, { chips }));
    }
  });
  it("chipTable: array entries keyed by scheme, record returned as is, junk tolerated", () => {
    const rec = { a: { scheme: "a" } };
    expect(chipTable(rec)).toBe(rec);
    expect(chipTable([{ scheme: "a" }, { scheme: "b", className: "c" }])).toEqual({ a: { scheme: "a" }, b: { scheme: "b", className: "c" } });
    expect(chipTable(undefined)).toEqual({});
    expect(chipTable([null as never, { scheme: "" } as never])).toEqual({});
  });
  it("the editor accepts a record too (and a scheme:kind key), with the same result as an array", () => {
    const run = (chips: never) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const ed = createEditor(host, { value: md, chips });
      const chip = host.querySelector(".atm-surface .atm-chip");
      const out = { cls: chip?.className, value: ed.getValue(), html: ed.getHtml() };
      ed.destroy();
      host.remove();
      return out;
    };
    const a = run([{ scheme: "task", className: "task-chip" }] as never);
    const b = run({ task: { scheme: "task", className: "task-chip" } } as never);
    expect(a.cls).toContain("task-chip");
    expect(b).toEqual(a);
    const c = run({ "task:issue": { scheme: "task", className: "kind-chip" } } as never);
    expect(c.cls).toContain("kind-chip");
    expect(c.value).toBe(md);
  });
  it("a click on a chip in the split preview finds a scheme:kind definition", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const got: string[] = [];
    const ed = createEditor(host, { value: md, mode: "split", chips: { "task:issue": { scheme: "task", onClick: (c) => got.push(c.id) } } });
    const chip = host.querySelector(".atm-preview .atm-chip") as HTMLElement;
    chip.click();
    expect(got).toEqual(["12"]);
    ed.destroy();
    host.remove();
  });
});
