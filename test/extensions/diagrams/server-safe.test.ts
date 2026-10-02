// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("server safety", () => {
  it("imports and builds a plugin with no window or document", async () => {
    expect(typeof document).toBe("undefined");
    const m = await import("../../../src/extensions/diagrams");
    const p = m.createDiagramsPlugin({ renderers: { mermaid: () => "<svg/>" } });
    expect(p.name).toBe("diagrams");
    expect(p.slash!.length).toBe(1);
    expect(m.parseDiagramMeta('title="x"').title).toBe("x");
  });
});
