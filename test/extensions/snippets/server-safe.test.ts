// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("snippets subpath on a server", () => {
  it("imports and builds everything with no DOM", async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    expect(typeof (globalThis as { window?: unknown }).window).toBe("undefined");
    const m = await import("../../../src/extensions/snippets/index");
    const sn = m.createSnippets();
    expect(sn.plugin.name).toBe("snippets");
    expect(sn.store.list()).toEqual([]);
    expect(m.localStorageSnippets().load()).toBeNull();
    expect(() => m.localStorageSnippets().save([])).not.toThrow();
    const mem = m.createSnippets({ storage: m.memorySnippets([{ id: "a", name: "A", body: "x {{date}}", scope: "inline" }]), now: () => new Date(2026, 0, 2) });
    expect(JSON.parse(mem.export()).snippets[0].id).toBe("a");
    expect((await mem.import(mem.export())).updated).toEqual(["a"]);
    expect(m.expandBody({ snippet: mem.store.list()[0], selection: "", now: () => new Date(2026, 0, 2) })).toEqual({ text: "x 2026-01-02", cursor: null });
    expect(m.escapeMarkdownText("*x*")).toBe("\\*x\\*");
  });
});
