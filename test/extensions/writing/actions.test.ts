import { afterEach, describe, expect, it } from "vitest";
import { createSelectionActionsPlugin, createLanguagePlugin, createWordGoalPlugin, type SelectionAction } from "../../../src/extensions/writing";
import { mount, selectText, caretAfter, typeInto, textareaReady, wait, type Mounted } from "../../plugins/helpers";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
});

const panel = () => m!.ed.element.querySelector<HTMLElement>(".atm-writing-panel");
const liveText = (name: string) => m!.ed.element.querySelector(`[data-atm-writing-live="${name}"]`)?.textContent ?? "";

function withActions(value: string, actions: SelectionAction[], extra = {}) {
  m = mount({ value, plugins: [createSelectionActionsPlugin({ actions, ...extra })] });
  m.surface.focus();
}

describe("selection actions", () => {
  it("exposes a command and a toolbar item per action", () => {
    const p = createSelectionActionsPlugin({ actions: [{ id: "upper", label: "Upper", run: (s) => s.text.toUpperCase() }, { id: "bad id!", label: "x", run: () => "" }] });
    expect(Object.keys(p.commands!)).toEqual(["selectionAction:cancel", "selectionAction:upper"]);
    expect(p.toolbar!.map((t) => t.id)).toEqual(["selectionAction:upper"]);
  });

  it("replaces the selection with the result in one undo step", async () => {
    withActions("Make this loud please.", [{ id: "upper", label: "Upper", run: (s) => `**${s.text.toUpperCase()}**` }]);
    selectText(m!.surface, "this loud");
    expect(m!.ed.exec("selectionAction:upper")).toBe(true);
    await wait(5);
    expect(m!.ed.getValue().trim()).toBe("Make **THIS LOUD** please.");
    expect(panel()).toBeNull();
    m!.ed.undo();
    expect(m!.ed.getValue().trim()).toBe("Make this loud please.");
  });

  it("shows a busy state, restores the saved selection after the user clicked elsewhere", async () => {
    let resolve!: (v: string) => void;
    withActions("First part. Second part.", [{ id: "x", label: "Rewrite", run: () => new Promise<string>((r) => (resolve = r)) }]);
    selectText(m!.surface, "First");
    m!.ed.exec("selectionAction:x");
    await wait(1);
    expect(panel()!.getAttribute("aria-busy")).toBe("true");
    expect(m!.surface.getAttribute("aria-busy")).toBe("true");
    expect(panel()!.querySelector('[data-action="cancel"]')).not.toBeNull();
    caretAfter(m!.surface, "Second");
    resolve("Opening");
    await wait(5);
    expect(m!.ed.getValue().trim()).toBe("Opening part. Second part.");
    expect(m!.surface.hasAttribute("aria-busy")).toBe(false);
  });

  it("insertAfter keeps the selection and inserts after it", async () => {
    withActions("Alpha beta.", [{ id: "a", label: "Add", replace: "insertAfter", run: () => " (gamma)" }]);
    selectText(m!.surface, "Alpha");
    m!.ed.exec("selectionAction:a");
    await wait(5);
    expect(m!.ed.getValue().trim()).toBe("Alpha (gamma) beta.");
  });

  it("does not replace when the selected text changed meanwhile, and offers the result to copy", async () => {
    let resolve!: (v: string) => void;
    withActions("Keep this text.", [{ id: "x", label: "Rewrite", run: () => new Promise<string>((r) => (resolve = r)) }]);
    selectText(m!.surface, "this");
    m!.ed.exec("selectionAction:x");
    await wait(1);
    m!.ed.setValue("Something else entirely.");
    resolve("THAT");
    await wait(50);
    expect(m!.ed.getValue().trim()).toBe("Something else entirely.");
    expect(panel()!.getAttribute("data-state")).toBe("changed");
    expect(panel()!.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("THAT");
    expect(liveText("actions")).toMatch(/changed/);
  });

  it("an error changes nothing and is announced; cancel aborts", async () => {
    withActions("Some text.", [
      { id: "bad", label: "Bad", run: () => Promise.reject(new Error("<b>nope</b>")) },
      { id: "slow", label: "Slow", run: (_s, c) => new Promise<string>((_r, rej) => c.signal.addEventListener("abort", () => rej(new Error("aborted")))) },
    ]);
    selectText(m!.surface, "Some");
    m!.ed.exec("selectionAction:bad");
    await wait(50);
    expect(m!.ed.getValue().trim()).toBe("Some text.");
    expect(panel()!.getAttribute("data-state")).toBe("error");
    expect(panel()!.querySelector("b")).toBeNull();
    expect(liveText("actions")).toBe("Bad failed. Nothing was changed.");
    selectText(m!.surface, "Some");
    m!.ed.exec("selectionAction:slow");
    expect(m!.ed.exec("selectionAction:cancel")).toBe(true);
    await wait(50);
    expect(panel()).toBeNull();
    expect(m!.ed.getValue().trim()).toBe("Some text.");
  });

  it("nothing selected or read-only: the command refuses", () => {
    withActions("Text", [{ id: "x", label: "X", run: () => "Y" }]);
    caretAfter(m!.surface, "Te");
    expect(m!.ed.exec("selectionAction:x")).toBe(false);
    selectText(m!.surface, "Text");
    m!.ed.setReadOnly(true);
    expect(m!.ed.exec("selectionAction:x")).toBe(false);
  });

  it("a hostile result goes through the link policy", async () => {
    withActions("Link me.", [{ id: "x", label: "X", run: () => "[click](javascript:alert(1)) <img src=x onerror=alert(1)>" }]);
    selectText(m!.surface, "Link");
    m!.ed.exec("selectionAction:x");
    await wait(5);
    for (const a of m!.surface.querySelectorAll("a")) expect(a.getAttribute("href") ?? "").not.toMatch(/javascript:/i);
    expect(m!.surface.querySelector("img")).toBeNull();
    for (const e of m!.surface.querySelectorAll("*")) for (const at of e.getAttributeNames()) expect(at.startsWith("on")).toBe(false);
  });

  it("works in the Markdown pane", async () => {
    m = mount({ value: "Source text", mode: "markdown", plugins: [createSelectionActionsPlugin({ actions: [{ id: "x", label: "X", run: (s) => s.text.toUpperCase() }] })] });
    const ta = await textareaReady(m);
    ta.focus();
    ta.setSelectionRange(0, 6);
    m.ed.exec("selectionAction:x");
    ta.setSelectionRange(9, 9);
    await wait(5);
    expect(m.ed.getValue().trim()).toBe("SOURCE text");
  });

  it("the floating menu appears over a selection when menu: true", async () => {
    withActions("Pick words here.", [{ id: "x", label: "Shorten", run: () => "w" }], { menu: true });
    selectText(m!.surface, "words");
    document.dispatchEvent(new Event("selectionchange"));
    await wait(5);
    const menu = m!.ed.element.querySelector(".atm-writing-menu")!;
    expect(menu.getAttribute("role")).toBe("toolbar");
    expect(m!.surface.contains(menu)).toBe(false);
    expect(menu.querySelector("button")!.textContent).toBe("Shorten");
  });
});

describe("spellcheck and language", () => {
  it("sets spellcheck and lang on the surface only when asked, emits events", () => {
    m = mount({ value: "x", plugins: [createLanguagePlugin({})] });
    const s = m.surface;
    expect(s.getAttribute("spellcheck")).toBe("true");
    expect(s.hasAttribute("lang")).toBe(false);
    const seen: unknown[] = [];
    m.ed.on("plugin:writing:spellcheck", (p) => seen.push(p));
    m.ed.on("plugin:writing:lang", (p) => seen.push(p));
    expect(m.ed.exec("toggleSpellcheck")).toBe(true);
    expect(s.getAttribute("spellcheck")).toBe("false");
    expect(m.ed.exec("toggleSpellcheck", false)).toBe(true);
    expect(s.getAttribute("spellcheck")).toBe("false");
    expect(m.ed.exec("setLanguage", "en-gb")).toBe(true);
    expect(s.getAttribute("lang")).toBe("en-GB");
    expect(m.ed.exec("setLanguage", "not a tag!")).toBe(false);
    expect(m.ed.exec("setLanguage", '"><svg onload=alert(1)>')).toBe(false);
    expect(s.getAttribute("lang")).toBe("en-GB");
    expect(m.ed.exec("setLanguage", "")).toBe(true);
    expect(s.hasAttribute("lang")).toBe(false);
    expect(seen).toEqual([{ spellcheck: false }, { spellcheck: false }, { lang: "en-GB" }, { lang: "" }]);
  });

  it("applies options at start and again to the Markdown pane and the preview", async () => {
    m = mount({ value: "x", plugins: [createLanguagePlugin({ spellcheck: false, lang: "de" })] });
    expect(m.surface.getAttribute("spellcheck")).toBe("false");
    expect(m.surface.getAttribute("lang")).toBe("de");
    m.ed.setMode("split");
    const ta = await textareaReady(m);
    await wait(5);
    expect(ta.getAttribute("spellcheck")).toBe("false");
    expect(ta.getAttribute("lang")).toBe("de");
    expect(m.ed.element.querySelector(".atm-preview")!.getAttribute("lang")).toBe("de");
  });
});

describe("word goal", () => {
  it("renders a named progress in the status bar and updates as you type", async () => {
    m = mount({ value: "one two", plugins: [createWordGoalPlugin({ goal: 4, debounceMs: 0 })] });
    const bar = m.ed.element.querySelector(".atm-statusbar")!;
    const p = bar.querySelector<HTMLProgressElement>("progress.atm-writing-goal-bar")!;
    expect(p.getAttribute("aria-label")).toBe("Word goal");
    expect(p.getAttribute("aria-valuetext")).toBe("2 of 4 words");
    expect(p.value).toBe(2);
    const events: { count: number; reached: boolean }[] = [];
    m.ed.on("plugin:writing:goal", (e) => events.push(e as never));
    m.surface.focus();
    caretAfter(m.surface, "two");
    await typeInto(m.surface, " three four");
    await wait(50);
    expect(p.getAttribute("aria-valuetext")).toBe("4 of 4 words");
    expect(events.at(-1)).toMatchObject({ count: 4, reached: true });
    expect(liveText("goal")).toBe("Goal reached: 4 words");
  });

  it("does not announce a goal that was already met at load; setValue recounts", async () => {
    let reached = 0;
    m = mount({ value: "a b c d e", plugins: [createWordGoalPlugin({ goal: 3, debounceMs: 0, onReached: () => reached++ })] });
    await wait(40);
    expect(liveText("goal")).toBe("");
    m.ed.setValue("x");
    await wait(5);
    expect(m.ed.element.querySelector("progress")!.getAttribute("aria-valuetext")).toBe("1 of 3 words");
    m.ed.setValue("x y z");
    await wait(40);
    expect(reached).toBe(1);
  });

  it("counts characters, and draws a badge without a status bar; setWordGoal changes it", () => {
    m = mount({ value: "**ab** cd", features: { statusBar: false }, plugins: [createWordGoalPlugin({ goal: 10, unit: "characters" })] });
    const item = m.ed.element.querySelector(".atm-writing-goal-badge")!;
    expect(item.querySelector("progress")!.getAttribute("aria-valuetext")).toBe("5 of 10 characters");
    expect(m.surface.contains(item)).toBe(false);
    expect(m.ed.exec("setWordGoal", 20)).toBe(true);
    expect(item.querySelector("progress")!.getAttribute("aria-valuetext")).toBe("5 of 20 characters");
    expect(m.ed.exec("setWordGoal", -1)).toBe(false);
    expect(m.ed.getValue().trim()).toBe("**ab** cd");
  });
});
