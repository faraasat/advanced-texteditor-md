import { describe, expect, it } from "vitest";
import { exportSnippets, importSnippets } from "../../../src/extensions/snippets/portability";
import { createSnippetStore } from "../../../src/extensions/snippets/store";
import type { Snippet } from "../../../src/extensions/snippets/model";

const sn = (id: string, extra: Partial<Snippet> = {}): Snippet => ({ id, name: id, body: "b " + id, scope: "inline", ...extra });
const file = (list: unknown[]) => JSON.stringify({ format: "advanced-texteditor-md/snippets", version: 1, snippets: list });

describe("export / import", () => {
  it("round-trips a store through JSON", async () => {
    const a = createSnippetStore({ storage: false, defaults: [sn("a", { trigger: ";a", keywords: ["k"], description: "d" }), sn("b", { scope: "block", body: "x\ny" })] });
    const json = exportSnippets(a);
    expect(JSON.parse(json).snippets.length).toBe(2);
    const b = createSnippetStore({ storage: false });
    const r = await importSnippets(json, { store: b });
    expect(r.added).toEqual(["a", "b"]);
    expect(r.applied).toBe(true);
    expect(b.list()).toEqual(a.list());
    expect(exportSnippets(b)).toBe(json);
  });

  it("exports a plain list too", () => {
    expect(JSON.parse(exportSnippets([sn("a")])).snippets[0].id).toBe("a");
  });

  it("merge: adds new ids, overwrites equal ids, keeps the rest", async () => {
    const st = createSnippetStore({ storage: false, defaults: [sn("a"), sn("keep")] });
    const r = await importSnippets(file([{ ...sn("a"), body: "changed" }, sn("n")]), { store: st });
    expect(r).toMatchObject({ mode: "merge", added: ["n"], updated: ["a"], removed: [], skipped: [] });
    expect(st.list().map((s) => s.id)).toEqual(["a", "keep", "n"]);
    expect(st.get("a")?.body).toBe("changed");
  });

  it("merge: a trigger that belongs to another snippet is skipped", async () => {
    const st = createSnippetStore({ storage: false, defaults: [sn("a", { trigger: ";x" })] });
    const r = await importSnippets(file([sn("b", { trigger: ";x" }), sn("c")]), { store: st });
    expect(r.added).toEqual(["c"]);
    expect(r.skipped).toEqual([expect.objectContaining({ id: "b", reason: "duplicate-trigger", index: 0 })]);
  });

  it("merge: an overwriting snippet may keep or free its own trigger, and another may take it", async () => {
    const st = createSnippetStore({ storage: false, defaults: [sn("a", { trigger: ";x" })] });
    const r = await importSnippets(file([sn("a", { trigger: ";y" }), sn("b", { trigger: ";x" })]), { store: st });
    expect(r.updated).toEqual(["a"]);
    expect(r.added).toEqual(["b"]);
    expect(st.byTrigger(";x")?.id).toBe("b");
  });

  it("replace: the file becomes the list and the report names what went", async () => {
    const st = createSnippetStore({ storage: false, defaults: [sn("a"), sn("gone")] });
    const r = await importSnippets(file([sn("a"), sn("n")]), { mode: "replace", store: st });
    expect(r).toMatchObject({ mode: "replace", added: ["n"], updated: ["a"], removed: ["gone"] });
    expect(st.list().map((s) => s.id)).toEqual(["a", "n"]);
  });

  it("replace never empties a store because every entry of the file was invalid", async () => {
    const st = createSnippetStore({ storage: false, defaults: [sn("a")] });
    const r = await importSnippets(file([{ id: "", name: "" }, 5]), { mode: "replace", store: st });
    expect(r.applied).toBe(false);
    expect(r.skipped.length).toBe(2);
    expect(st.list().length).toBe(1);
    // an explicit empty list does replace
    const e = await importSnippets(file([]), { mode: "replace", store: st });
    expect(e.applied).toBe(true);
    expect(st.list().length).toBe(0);
  });

  it("reports every bad entry with its index and reason, applies the good ones", async () => {
    const st = createSnippetStore({ storage: false });
    const r = await importSnippets(file([sn("ok"), { id: "bad id", name: "x", body: "y" }, { id: "ok", name: "dup", body: "z" }, "str"]), { store: st });
    expect(r.added).toEqual(["ok"]);
    expect(r.skipped.map((s) => [s.index, s.reason])).toEqual([[1, "bad-id"], [2, "duplicate-id"], [3, "not-an-object"]]);
  });

  it("an unusable file changes nothing", async () => {
    const st = createSnippetStore({ storage: false, defaults: [sn("a")] });
    for (const text of ["{", "42", '{"version":3,"snippets":[]}', '{"snippets":5}']) {
      const r = await importSnippets(text, { mode: "replace", store: st });
      expect(r.applied).toBe(false);
      expect(r.skipped[0]).toMatchObject({ index: -1 });
      expect(st.list().length).toBe(1);
    }
  });

  it("accepts a bare list and makes ids from names when a hand-written file leaves them out", async () => {
    const st = createSnippetStore({ storage: false });
    const r = await importSnippets(JSON.stringify([{ name: "Meeting notes", body: "x\ny" }, { name: "Meeting notes", body: "z" }, { name: "!!!", body: "q" }]), { store: st });
    expect(r.added).toEqual(["meeting-notes", "meeting-notes-2", "snippet"]);
  });

  it("is a dry run without a store", async () => {
    const r = await importSnippets(file([sn("n")]), { existing: [sn("a")] });
    expect(r.applied).toBe(false);
    expect(r.list.map((s) => s.id)).toEqual(["a", "n"]);
  });

  it("does not let __proto__ keys through", async () => {
    const st = createSnippetStore({ storage: false });
    const r = await importSnippets('{"version":1,"snippets":[{"id":"a","name":"n","body":"b","__proto__":{"scope":"block"}},{"id":"__proto__","name":"n","body":"b"}]}', { store: st });
    expect(r.added).toEqual(["a"]);
    expect(st.get("a")?.scope).toBe("inline");
    expect(r.skipped[0].reason).toBe("bad-id");
  });
});
