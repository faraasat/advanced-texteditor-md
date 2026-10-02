import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DRAFTS_CSS } from "../../src/plugins/drafts";
import { FIND_REPLACE_CSS } from "../../src/plugins/find-replace";
import { SHORTCODES_CSS } from "../../src/plugins/shortcodes";
import { TEXT_STYLE_CSS, createTextStylePlugin } from "../../src/plugins/text-style";
import { TOC_CSS, createTocPlugin } from "../../src/plugins/toc";
import { createDraftsPlugin } from "../../src/plugins/drafts";
import { createFindReplacePlugin } from "../../src/plugins/find-replace";
import { createShortcodesPlugin } from "../../src/plugins/shortcodes";

// src/styles/plugins.css is the same text as the strings the plugins inject. Two places that must
// agree: this test is what makes them.
const file = readFileSync(resolve(process.cwd(), "src/styles/plugins.css"), "utf8");

describe("plugins.css", () => {
  it.each([
    ["find-replace", FIND_REPLACE_CSS],
    ["drafts", DRAFTS_CSS],
    ["toc", TOC_CSS],
    ["text-style", TEXT_STYLE_CSS],
    ["shortcodes", SHORTCODES_CSS],
  ])("contains the %s stylesheet verbatim", (_name, css) => {
    expect(file).toContain(css);
  });
  it("each plugin's css field is its exported string (or, for text-style, derived from its allow-list)", () => {
    expect(createFindReplacePlugin().css).toBe(FIND_REPLACE_CSS);
    expect(createDraftsPlugin().css).toBe(DRAFTS_CSS);
    expect(createTocPlugin().css).toBe(TOC_CSS);
    expect(createShortcodesPlugin({ shortcodes: {} }).css).toBe(SHORTCODES_CSS);
    expect(TEXT_STYLE_CSS).toContain(createTextStylePlugin().css!.split("\n")[0]);
  });
  it("uses only theme variables with fallbacks, no host names", () => {
    expect(file).not.toMatch(/dunzo|hub/i);
    for (const m of file.matchAll(/var\((--[\w-]+)(,|\))/g)) expect(m[2], `${m[1]} needs a fallback`).toBe(",");
  });
});
