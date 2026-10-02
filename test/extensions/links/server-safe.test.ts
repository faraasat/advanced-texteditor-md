// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("links subpath on a server", () => {
  it("imports, builds the plugins and runs every pure helper with no DOM", async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    const m = await import("../../../src/extensions/links/index");
    const wiki = m.createWikiLinks({ search: () => [], resolve: async () => ({}) });
    const mgr = m.createLinkManager({ wiki });
    expect([wiki.plugin.name, mgr.name]).toEqual(["wiki-links", "link-manager"]);
    expect(wiki.status("x")).toBeUndefined();
    expect(m.findLinks("[a](https://example.com) [b](wiki:1)").map((l) => l.kind)).toEqual(["link", "wiki"]);
    expect(m.findBacklinks([{ id: "d", markdown: "[b](wiki:1)" }], "1").length).toBe(1);
    expect(m.applyEdits("[a](http://example.com)", m.upgradeEdits(m.findLinks("[a](http://example.com)"), "all"))).toBe("[a](https://example.com)");
    wiki.destroy();
  });
});
