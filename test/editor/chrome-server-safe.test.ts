// @vitest-environment node
import { describe, it, expect } from "vitest";

describe("the package imports and its pure parts run with no DOM", () => {
  it("has no document or window here", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    expect(typeof navigator === "undefined" || true).toBe(true);
  });

  it("the public entry imports and exposes the whole API", async () => {
    const lib = await import("../../src/index");
    for (const name of [
      "createEditor", "parse", "stringify", "renderHtml", "renderDom", "renderMarkdown", "createHighlighter", "createMathRenderer",
      "texToMathML", "validateFile", "urlAllowed", "createPutUploader", "createFormUploader", "createPresignedUploader",
      "createDataUrlUploader", "htmlToMarkdown", "definePlugin", "defineInlineSyntax", "defineBlockSyntax", "defineLayout",
      "defineToolbarItem", "builtinToolbarItems", "highlightMark", "callout", "kbd", "subSup", "DEFAULT_LABELS", "VERSION",
    ]) {
      expect((lib as Record<string, unknown>)[name], name).toBeDefined();
    }
    expect(lib.VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("markdown <-> html works on the server through the same entry", async () => {
    const { renderMarkdown, parse, stringify } = await import("../../src/index");
    expect(renderMarkdown("**x**")).toContain("<strong");
    expect(stringify(parse("- a\n- b"))).toBe("- a\n- b");
  });

  it("VERSION matches package.json", async () => {
    const { VERSION } = await import("../../src/index");
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });

  it("every chrome module imports", async () => {
    const mods = await Promise.all([
      import("../../src/editor/dom"),
      import("../../src/editor/i18n"),
      import("../../src/editor/theme"),
      import("../../src/editor/layouts"),
      import("../../src/editor/toolbar"),
      import("../../src/editor/status-bar"),
      import("../../src/editor/slash"),
      import("../../src/editor/popovers"),
      import("../../src/editor/markdown-pane"),
      import("../../src/editor/create-editor"),
      import("../../src/plugins"),
    ]);
    expect(mods.every(Boolean)).toBe(true);
  });

  it("the pure helpers need no DOM", async () => {
    const md = await import("../../src/editor/markdown-pane");
    expect(md.applyMarkdownCommand({ value: "a", start: 0, end: 1 }, "bold")!.value).toBe("**a**");
    expect(md.continueMarkdown({ value: "- a", start: 3, end: 3 })!.value).toBe("- a\n- ");
    const tb = await import("../../src/editor/toolbar");
    expect(tb.computeOverflow([10, 10], 100, 5)).toBe(2);
    expect(tb.builtinToolbarItems().map((i) => i.id)).toContain("bold");
    const dom = await import("../../src/editor/dom");
    expect(dom.formatShortcut("Mod-b", "mac")).toBe("⌘B");
    expect(["mac", "windows", "linux", "other"]).toContain(dom.detectPlatform()); // Node 21+ has a navigator
    const sl = await import("../../src/editor/slash");
    expect(sl.detectSlash("/x")).toEqual({ query: "x", start: 0 });
    const th = await import("../../src/editor/theme");
    expect(th.tokensToVars({ bg: "#000" })["--atm-bg"]).toBe("#000");
    const st = await import("../../src/editor/status-bar");
    expect(st.countState(95, 100)).toBe("warn");
    const pop = await import("../../src/editor/popovers");
    expect(pop.normalizeLinkInput("a.io")).toBe("https://a.io");
    const ce = await import("../../src/editor/create-editor");
    expect(ce.alignOffset("hello", 5, "**hello** world", 80)).toBe(7);
  });

  it("the built-in plugins are plain data", async () => {
    const { highlightMark, callout, kbd, subSup } = await import("../../src/plugins");
    expect(JSON.stringify([highlightMark, callout, kbd, subSup]).length).toBeGreaterThan(100);
  });
});
