import { describe, expect, it } from "vitest";
import { make } from "./surface-helpers";

describe("insertMarkdown / insertText with no focus or selection", () => {
  it("insertMarkdown appends at the end and parses", () => {
    const t = make("first");
    document.getSelection()?.removeAllRanges();
    t.s.insertMarkdown("**bold**");
    expect(t.s.getValue()).toBe("first**bold**");
    expect(t.root.querySelector("strong")?.textContent).toBe("bold");
  });
  it("insertMarkdown with block syntax lands after the last block", () => {
    const t = make("first");
    document.getSelection()?.removeAllRanges();
    t.s.insertMarkdown("\n\n## Title");
    expect(t.s.getValue()).toBe("first\n\n## Title");
  });
  it("insertText is literal: Markdown syntax stays text", () => {
    const t = make("first ");
    document.getSelection()?.removeAllRanges();
    t.s.insertText("**x**");
    expect(t.root.querySelector("strong")).toBeNull();
    expect(t.s.getValue()).toContain("\\*\\*x\\*\\*");
  });
  it("an empty editor accepts an insert", () => {
    const t = make("");
    document.getSelection()?.removeAllRanges();
    t.s.insertMarkdown("hello");
    expect(t.s.getValue()).toBe("hello");
  });
});
