import { describe, expect, it } from "vitest";
import { defaultFilename, displayName, firstHeading, sanitizeFilename } from "../../../src/extensions/export/filename";
import { expectLinear } from "./scaling-helper";

describe("sanitizeFilename", () => {
  it("adds the extension once", () => {
    expect(sanitizeFilename("notes", { ext: ".md" })).toBe("notes.md");
    expect(sanitizeFilename("notes.md", { ext: ".md" })).toBe("notes.md");
    expect(sanitizeFilename("notes.MD", { ext: ".md" })).toBe("notes.md");
    expect(sanitizeFilename("a.b", { ext: ".html" })).toBe("a.b.html");
  });
  it("removes path separators and reserved characters", () => {
    expect(sanitizeFilename("../../etc/passwd", { ext: ".md" })).toBe("etc-passwd.md");
    expect(sanitizeFilename("a\\b/c:d*e?f\"g<h>i|j", { ext: ".md" })).toBe("a-b-c-d-e-f-g-h-i-j.md");
    expect(sanitizeFilename("100%", { ext: ".md" })).toBe("100.md");
  });
  it("removes control, bidi and zero-width characters", () => {
    const hostile = "re\u0000po\u0007rt‮fdp.exe​⁦x﻿";
    const out = sanitizeFilename(hostile, { ext: ".md" });
    expect(out).toBe("report" + "fdp.exex.md");
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/);
  });
  it("never starts with a dot or ends with a dot or space", () => {
    expect(sanitizeFilename(".htaccess", { ext: ".md" })).toBe("htaccess.md");
    expect(sanitizeFilename("..", { ext: ".md" })).toBe("document.md");
    expect(sanitizeFilename("name. . .", { ext: ".md" })).toBe("name.md");
  });
  it("renames Windows device names", () => {
    for (const n of ["CON", "nul", "COM1", "lpt9", "AUX", "PRN", "con.txt"]) {
      const out = sanitizeFilename(n, { ext: ".md" });
      expect(out.startsWith("_")).toBe(true);
    }
    expect(sanitizeFilename("console", { ext: ".md" })).toBe("console.md");
  });
  it("falls back when nothing is left", () => {
    expect(sanitizeFilename("", { ext: ".md" })).toBe("document.md");
    expect(sanitizeFilename("///", { ext: ".md" })).toBe("document.md");
    expect(sanitizeFilename(undefined, { ext: ".md", fallback: "untitled" })).toBe("untitled.md");
    expect(sanitizeFilename(42, { ext: ".md" })).toBe("document.md");
  });
  it("caps the length, extension included, without cutting a surrogate pair", () => {
    const out = sanitizeFilename("a".repeat(500), { ext: ".md", maxLength: 40 });
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith(".md")).toBe(true);
    const emoji = sanitizeFilename("😀".repeat(100), { ext: ".md", maxLength: 21 });
    expect(emoji.length).toBeLessThanOrEqual(21);
    expect(emoji).not.toMatch(/[\ud800-\udbff]\.md$/);
  });
  it("is idempotent", () => {
    for (const n of ["a b", "../x", "CON", "😀😀", " .. a ", "Report: Q3/Q4"]) {
      const once = sanitizeFilename(n, { ext: ".md" });
      expect(sanitizeFilename(once, { ext: ".md" })).toBe(once);
    }
  });
  it("is linear on a huge name", () => {
    expectLinear((n) => () => void sanitizeFilename("a/b ".repeat(n), { ext: ".md" }), 50_000);
  });
});

describe("defaultFilename", () => {
  it("is the slug of the first heading", () => {
    expect(defaultFilename("intro\n\n## Café & Crème!\n\n# Later")).toBe("cafe-creme");
    expect(defaultFilename("# **Bold** [link](http://x) `code`")).toBe("bold-link-code");
  });
  it("skips fenced code and falls back", () => {
    expect(defaultFilename("```\n# not a heading\n```\n\ntext")).toBe("document");
    expect(defaultFilename("```\n# no\n```\n\n# Yes")).toBe("yes");
    expect(defaultFilename("")).toBe("document");
    expect(defaultFilename("# !!!")).toBe("document");
  });
  it("reads a closing-hash heading", () => {
    expect(firstHeading("## Title ##")).toBe("Title");
  });
  it("is linear", () => {
    expectLinear((n) => () => void defaultFilename("line\n".repeat(n) + "# x"), 50_000);
  });
});

describe("displayName", () => {
  it("hides invisible characters and shortens", () => {
    expect(displayName("a‮b​c")).toBe("abc");
    expect(displayName("x".repeat(200)).length).toBe(80);
  });
});
