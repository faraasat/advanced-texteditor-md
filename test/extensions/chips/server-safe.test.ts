// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("chips subpath on a server", () => {
  it("imports and builds every plugin and helper with no DOM", async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    const m = await import("../../../src/extensions/chips/index");
    const plugins = [
      m.createChipCardsPlugin({ getCard: () => null }),
      m.createChipDecorPlugin({ removable: true }),
      m.createChipPickerPlugin({ id: "p", label: "P", scheme: "mention", search: () => [] }),
      m.createMarkdownMentionsPlugin(),
      m.createMentionRanker({ storage: null }).plugin,
      m.createTagTrigger({ tags: ["a"] }).plugin!,
      m.createCommandTrigger({ commands: [{ id: "a", label: "A", run: () => {} }] }).plugin,
    ];
    expect(plugins.every((p) => typeof p.name === "string")).toBe(true);
    expect(m.chipMarkdown({ scheme: "mention", kind: "", id: "1", label: "A", trigger: "@" })).toBe("[@A](mention:1)");
    expect(m.rankMentions([{ id: "1", label: "a" }], "a").length).toBe(1);
    expect(await m.expandGroupMentions([], () => [])).toEqual([]);
  });
});
