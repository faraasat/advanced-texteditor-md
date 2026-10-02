import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRONT_MATTER_CSS } from "../../../src/extensions/frontmatter";

// The editor draws the panel in a shadow root (FRONT_MATTER_CSS); a read-only view draws it in the page,
// where the same rules come from the feature stylesheet. If they differ, a panel looks different in the
// two places, so one copy must contain the other.
describe("frontmatter styles", () => {
  it("the stylesheet repeats the shadow-root rules exactly", () => {
    const css = readFileSync("src/styles/features/frontmatter.css", "utf8");
    expect(css).toContain(FRONT_MATTER_CSS.trimEnd());
  });
  it("loads nothing from outside", () => {
    expect(FRONT_MATTER_CSS).not.toMatch(/url\(|@import|expression\(/i);
  });
});
