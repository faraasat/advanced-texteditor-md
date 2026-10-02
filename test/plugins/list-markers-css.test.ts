import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The real cascade is checked in a browser (e2e/list-markers.spec.ts). This pins the rules.
const css = readFileSync(resolve(process.cwd(), "src/styles/surface.css"), "utf8");

describe("surface.css list markers", () => {
  it.each([
    [".atm-surface ul,\n.atm-ul {\n  list-style-type: disc;"],
    [".atm-surface ol,\n.atm-ol {\n  list-style-type: decimal;"],
    ["list-style-type: circle;"],
    ["list-style-type: square;"],
    [".atm-surface li.atm-task,\n.atm-li.atm-task {\n  list-style: none;"],
  ])("writes %j", (rule) => expect(css).toContain(rule));
  it("gives rendered lists room for the markers", () => {
    expect(css).toContain(".atm-ul,\n.atm-ol {\n  padding-inline-start: 1.6em;");
  });
});
