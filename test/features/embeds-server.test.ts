// @vitest-environment node
import { describe, it, expect } from "vitest";

describe("embeds and link-preview import and run their pure parts with no DOM", () => {
  it("embeds", async () => {
    expect(typeof document).toBe("undefined");
    const e = await import("../../src/features/embeds");
    expect(e.matchEmbed("https://youtu.be/dQw4w9WgXcQ", e.BUILTIN_EMBEDS)?.provider.name).toBe("YouTube");
    expect(() => e.createEmbedElement(e.matchEmbed("https://youtu.be/dQw4w9WgXcQ", e.BUILTIN_EMBEDS)!)).toThrow();
  });
  it("link-preview: load works, rendering needs a DOM", async () => {
    const lp = await import("../../src/features/link-preview");
    const c = lp.createLinkPreviewController({
      options: { resolve: async (url) => ({ url, title: "T" }) },
    });
    expect((await c.load("https://example.com/a"))?.title).toBe("T");
    expect(await c.load("http://localhost/x")).toBeNull();
    expect(() => c.renderCard({ url: "https://example.com", title: "x" })).toThrow();
    c.destroy();
  });
});
