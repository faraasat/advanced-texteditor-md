// @vitest-environment node
import { describe, it, expect } from "vitest";

describe("feature modules import cleanly with no DOM", () => {
  it("has no document/window in this environment", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });
  it("upload-policy and uploaders", async () => {
    const policy = await import("../../src/features/upload-policy");
    const up = await import("../../src/features/uploaders");
    expect(policy.urlAllowed("https://a.com")).toBe(true);
    expect(typeof up.createPutUploader).toBe("function");
    expect(await up.probeImage({ type: "image/png" } as File)).toBeUndefined();
  });
  it("mentions: pure helpers work", async () => {
    const m = await import("../../src/features/mentions");
    expect(m.detectTrigger("hi @ja", ["@"], true)?.query).toBe("ja");
  });
  it("paste: looksLikeMarkdown works without a DOM", async () => {
    const p = await import("../../src/features/paste");
    expect(p.looksLikeMarkdown("# a\n\n- b\n- c")).toBe(true);
    expect(() => p.htmlToMarkdown("<b>x</b>")).toThrow(/Document|DOMParser/);
  });
});
