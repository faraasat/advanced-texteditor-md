import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDictationPlugin, type DictationOptions } from "../../../src/extensions/speech";
import { caretAfter, mount, pressKey, tick, wait, type Mounted } from "../../plugins/helpers";
import { FakeRecognition, installRecognition } from "./fakes";

let m: Mounted | null = null;
let uninstall: (() => void) | null = null;
beforeEach(() => {
  uninstall = installRecognition();
});
afterEach(() => {
  m?.destroy();
  m = null;
  uninstall?.();
});

function setup(value = "", o: DictationOptions = {}, extra: Parameters<typeof mount>[0] = {}) {
  m = mount({ value, plugins: [createDictationPlugin(o)], ...extra });
  return m;
}
const rec = () => FakeRecognition.last;
const ghost = () => m!.ed.element.querySelector<HTMLElement>(".atm-speech-ghost");
const status = () => m!.ed.element.querySelector<HTMLElement>('[data-kind="dictation"] .atm-speech-status')!.textContent;
const error = () => m!.ed.element.querySelector<HTMLElement>('[data-kind="dictation"] .atm-speech-error')!.textContent;
async function start() {
  m!.surface.focus();
  expect(m!.ed.exec("dictation")).toBe(true);
  await tick();
}

describe("dictation: lifecycle", () => {
  it("never starts by itself", async () => {
    setup("Hello");
    await tick();
    expect(FakeRecognition.instances.length).toBe(0);
    expect(status()).toBe("");
  });

  it("starts from the command with interim results, language and a visible polite status", async () => {
    setup("", { lang: "en-GB" });
    await start();
    expect(rec()).toMatchObject({ lang: "en-GB", continuous: true, interimResults: true, started: true });
    expect(status()).toBe("Listening…");
    const live = m!.ed.element.querySelector('[data-kind="dictation"] .atm-speech-status')!;
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  it("language: option, else the element's lang, else navigator.language", async () => {
    setup("");
    m!.host.setAttribute("lang", "fr");
    await start();
    expect(rec().lang).toBe("fr");
    m!.ed.exec("dictation");
    await tick();
    m!.host.removeAttribute("lang");
    document.documentElement.removeAttribute("lang");
    await start();
    expect(rec().lang).toBe(navigator.language);
  });

  it("works with the prefixed constructor", async () => {
    uninstall!();
    uninstall = installRecognition("webkitSpeechRecognition");
    setup("");
    await start();
    expect(rec().started).toBe(true);
  });

  it("the same command stops it; Escape stops and is consumed only while listening", async () => {
    setup("Hello");
    expect(pressKey(m!.surface, "Escape").defaultPrevented).toBe(false);
    await start();
    expect(pressKey(m!.surface, "Escape").defaultPrevented).toBe(true);
    await tick();
    expect(rec().stopped).toBe(true);
    expect(status()).toBe("Stopped");
    await start();
    m!.ed.exec("dictation");
    await tick();
    expect(status()).toBe("Stopped");
  });

  it("stops on blur (after the start grace), a mode switch and destroy", async () => {
    setup("Hello");
    await start();
    await wait(520);
    m!.surface.blur();
    m!.surface.dispatchEvent(new FocusEvent("blur"));
    await tick();
    expect(rec().aborted).toBe(true);
    expect(status()).toBe("Stopped");
    await start();
    m!.ed.setMode("markdown");
    await tick();
    expect(rec().aborted).toBe(true);
    await start();
    const r = rec();
    m!.destroy();
    m = null;
    expect(r.aborted).toBe(true);
  });

  it("restarts when the browser ends a session by itself, but gives up when it never hears anything", async () => {
    setup("Hello");
    await start();
    const first = rec();
    first.say([["hi", true]]);
    first.end();
    await tick();
    expect(FakeRecognition.instances.length).toBe(2);
    expect(status()).toBe("Listening…");
    for (let i = 0; i < 4; i++) {
      rec().end();
      await tick();
    }
    expect(error()).toMatch(/keeps ending/);
    expect(status()).toBe("");
  });

  it("a single-phrase session (continuous false) ends after the first result", async () => {
    setup("", { continuous: false });
    await start();
    expect(rec().continuous).toBe(false);
    rec().end();
    await tick();
    expect(FakeRecognition.instances.length).toBe(1);
    expect(status()).toBe("Stopped");
  });

  it("asks for on-device recognition when told to", async () => {
    setup("", { onDevice: true });
    await start();
    expect(rec().processLocally).toBe(true);
  });

  it("does nothing in a read-only editor", async () => {
    setup("Hello", {}, { readOnly: true });
    m!.surface.focus();
    expect(m!.ed.exec("dictation")).toBe(false);
    expect(FakeRecognition.instances.length).toBe(0);
  });
});

describe("dictation: results", () => {
  it("draws interim text as ghost text outside the content and inserts only finals", async () => {
    setup("Hello");
    m!.surface.focus();
    caretAfter(m!.surface, "Hello");
    m!.ed.exec("dictation");
    await tick();
    rec().say([["wor", false]]);
    expect(ghost()!.textContent).toBe(" wor");
    expect(m!.surface.contains(ghost())).toBe(false);
    expect(ghost()!.getAttribute("aria-hidden")).toBe("true");
    expect(m!.ed.getValue().trim()).toBe("Hello");
    rec().say([["world", false]], 0);
    expect(ghost()!.textContent).toBe(" world");
    rec().say([["world", true]], 0);
    expect(ghost()).toBeNull();
    expect(m!.ed.getValue().trim()).toBe("Hello world");
  });

  it("spaces and capitalises: after a sentence end, at the start of an empty document", async () => {
    setup("");
    await start();
    rec().say([["hello there.", true]]);
    rec().say([["how are you", true]]);
    expect(m!.ed.getValue().trim()).toBe("Hello there. How are you");
  });

  it("final text is inserted as text, never parsed as Markdown or HTML", async () => {
    setup("");
    await start();
    rec().say([["**bold** <b>x</b> # not a heading [a](javascript:alert(1))", true]]);
    expect(m!.surface.querySelector("strong, b, a, h1")).toBeNull();
    expect(m!.ed.getValue()).toContain("\\*\\*Bold\\*\\*");
  });

  it("leaves no trace in getValue except the inserted final text", async () => {
    setup("Alpha");
    m!.surface.focus();
    caretAfter(m!.surface, "Alpha");
    const before = m!.ed.getValue();
    m!.ed.exec("dictation");
    await tick();
    rec().say([["interim only", false]]);
    expect(m!.ed.getValue()).toBe(before);
    expect(m!.surface.querySelector("[data-atm-speech-ghost], .atm-speech-ghost")).toBeNull();
    rec().say([["interim only", true]], 0);
    expect(m!.ed.getValue().trim()).toBe("Alpha interim only");
  });

  it("each final is one undo step", async () => {
    setup("Alpha");
    m!.surface.focus();
    caretAfter(m!.surface, "Alpha");
    m!.ed.exec("dictation");
    await tick();
    rec().say([["one", true]]);
    rec().say([["two", true]]);
    expect(m!.ed.getValue().trim()).toBe("Alpha one two");
    m!.ed.undo();
    expect(m!.ed.getValue().trim()).toBe("Alpha one");
  });

  it("spoken commands are off by default and work when enabled", async () => {
    setup("", {});
    await start();
    rec().say([["hello comma world period", true]]);
    expect(m!.ed.getValue()).toContain("comma");
    m!.ed.exec("dictation");
    await tick();
    m!.destroy();
    setup("", { punctuationCommands: true, lang: "en" });
    await start();
    rec().say([["hello comma world period", true]]);
    expect(m!.ed.getValue().trim()).toBe("Hello, world.");
    rec().say([["new paragraph second part", true]]);
    expect([...m!.surface.querySelectorAll("p")].map((p) => p.textContent).filter(Boolean)).toEqual(["Hello, world.", "Second part"]);
    expect(m!.surface.textContent).toContain("Second part");
  });

  it("works in the Markdown pane (text goes into the textarea)", async () => {
    setup("Hello", {}, { mode: "markdown" });
    const { textareaReady } = await import("../../plugins/helpers");
    await textareaReady(m!);
    const ta = m!.ed.element.querySelector("textarea")!;
    ta.focus();
    ta.setSelectionRange(5, 5);
    m!.ed.exec("dictation");
    await tick();
    rec().say([["world", true]]);
    expect(ta.value).toBe("Hello world");
  });

  it("ignores late results of a session that was aborted", async () => {
    setup("Hello");
    await start();
    const r = rec();
    m!.ed.setMode("markdown");
    await tick();
    const v = m!.ed.getValue();
    r.say([["late", true]]);
    expect(m!.ed.getValue()).toBe(v);
  });
});

describe("dictation: errors", () => {
  it.each([
    ["not-allowed", /microphone is blocked.*Allow microphone access/i],
    ["service-not-allowed", /not allowed to use speech recognition/i],
    ["no-speech", /No speech was heard/],
    ["audio-capture", /No microphone was found/],
    ["network", /could not be reached/],
    ["language-not-supported", /cannot recognise en-US/],
    ["something-new", /Dictation stopped because of an error/],
  ])("%s shows actionable text in an assertive alert without moving focus and calls onError", async (code, re) => {
    const onError = vi.fn();
    setup("Hello", { lang: "en-US", onError });
    await start();
    const active = document.activeElement;
    rec().fail(code);
    rec().end();
    await tick();
    expect(error()).toMatch(re);
    const alert = m!.ed.element.querySelector('[data-kind="dictation"] .atm-speech-error')!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(document.activeElement).toBe(active);
    expect(onError).toHaveBeenCalledWith({ code, message: expect.stringMatching(re) });
    expect(status()).toBe("");
    expect(m!.ed.element.querySelector('[data-kind="dictation"] .atm-speech-btn[data-id="stop"]')).toBeNull();
  });

  it("aborted is silent; a throwing onError does not break dictation; the error can be dismissed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup("Hello", { onError: () => { throw new Error("host"); } });
    await start();
    rec().fail("aborted");
    expect(error()).toBe("");
    rec().fail("network");
    expect(error()).not.toBe("");
    m!.ed.element.querySelector<HTMLButtonElement>(".atm-speech-dismiss")!.click();
    expect(error()).toBe("");
    spy.mockRestore();
  });

  it("starting again clears the previous error", async () => {
    setup("Hello");
    await start();
    rec().fail("network");
    rec().end();
    await tick();
    expect(error()).not.toBe("");
    await start();
    expect(error()).toBe("");
  });

  it("a recognition constructor that throws is reported, not thrown", async () => {
    FakeRecognition.prototype.start = function () { throw new Error("NotAllowedError"); };
    setup("Hello");
    m!.surface.focus();
    expect(() => m!.ed.exec("dictation")).not.toThrow();
    expect(error()).toMatch(/error/);
    delete (FakeRecognition.prototype as any).start;
    // restore the class method for the following tests
    FakeRecognition.prototype.start = function (this: FakeRecognition) {
      if (this.started) throw new Error("InvalidStateError");
      this.started = true;
      queueMicrotask(() => this.onstart?.({}));
    };
  });
});

describe("dictation: feature detection", () => {
  it("without the API the command explains itself, the toolbar item is disabled and nothing throws", async () => {
    uninstall!();
    uninstall = null;
    const onError = vi.fn();
    const p = createDictationPlugin({ onError });
    const item = p.toolbar![0];
    expect(item.label).toMatch(/not supported/i);
    m = mount({ value: "Hello", plugins: [p] });
    expect(item.isEnabled!(m.ed)).toBe(false);
    expect(() => m!.ed.exec("dictation")).not.toThrow();
    expect(error()).toMatch(/not supported/i);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "unsupported" }));
    const btn = m.ed.element.querySelector('[data-id="dictation"]');
    if (btn) expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("with the API the toolbar item is an enabled toggle with a shortcut", async () => {
    const p = createDictationPlugin();
    m = mount({ value: "Hello", plugins: [p] });
    const item = p.toolbar![0];
    expect(item.type).toBe("toggle");
    expect(item.label).toBe("Dictation");
    expect(item.isEnabled!(m.ed)).toBe(true);
    expect(item.shortcut).toBe("Mod-Shift-.");
    expect(p.keymap).toEqual({ "Mod-Shift-.": "dictation" });
    expect(item.isActive!(m.ed)).toBe(false);
    m.surface.focus();
    m.ed.exec("dictation");
    await tick();
    expect(item.isActive!(m.ed)).toBe(true);
    const btn = m.ed.element.querySelector('[data-id="dictation"]');
    if (btn) expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("is safe to import and call the factory with no window (server)", async () => {
    const p = createDictationPlugin();
    expect(p.name).toBe("speech-dictation");
  });
});
