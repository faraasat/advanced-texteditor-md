import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadAloudPlugin, type ReadAloudOptions } from "../../../src/extensions/speech";
import { caretAfter, mount, pressKey, selectText, tick, textareaReady, type Mounted } from "../../plugins/helpers";
import { FakeSynth, FakeUtterance, installSynthesis } from "./fakes";

class FakeHighlight {
  ranges: Range[];
  constructor(...r: Range[]) {
    this.ranges = r;
  }
}

let m: Mounted | null = null;
let synth: FakeSynth;
let uninstall: () => void;
beforeEach(() => {
  const i = installSynthesis();
  synth = i.synth;
  uninstall = i.uninstall;
  (window as any).CSS = { highlights: new Map() };
  (window as any).Highlight = FakeHighlight;
});
afterEach(() => {
  m?.destroy();
  m = null;
  uninstall();
  delete (window as any).CSS;
  delete (window as any).Highlight;
});

const hl = () => (window as any).CSS.highlights as Map<string, FakeHighlight>;
const named = (suffix: string) => [...hl().entries()].filter(([k]) => k.endsWith(suffix));
const text = (h: FakeHighlight | undefined) => h?.ranges.map((r) => r.toString()).join("|");

function setup(value: string, o: ReadAloudOptions = {}, extra: Parameters<typeof mount>[0] = {}) {
  m = mount({ value, plugins: [createReadAloudPlugin(o)], ...extra });
  return m;
}
const panel = () => m!.ed.element.querySelector<HTMLElement>('[data-kind="read-aloud"]')!;
const status = () => panel().querySelector(".atm-speech-status")!.textContent;
const error = () => panel().querySelector(".atm-speech-error")!.textContent;
async function run() {
  expect(m!.ed.exec("readAloud")).toBe(true);
  await tick();
}
async function endAll() {
  for (let i = 0; i < 50 && synth.current; i++) {
    synth.finish();
    await tick();
  }
}

describe("read aloud: what is spoken", () => {
  it("never speaks by itself", async () => {
    setup("Hello world");
    await tick();
    expect(synth.spoken.length).toBe(0);
  });

  it("speaks the document one block at a time as plain text, with no Markdown syntax", async () => {
    setup("# Title\n\nSome **bold** and [a link](https://example.com).\n\n- item one\n- item two\n\n```js\nconst hidden = 1;\n```\n\n> quoted");
    await run();
    const said: string[] = [];
    while (synth.current) {
      said.push(synth.current.text);
      synth.finish();
      await tick();
    }
    expect(said).toEqual(["Title", "Some bold and a link.", "item one", "item two", "quoted"]);
    expect(status()).toBe("Finished reading");
  });

  it("reads the selection only", async () => {
    setup("First paragraph here.\n\nSecond paragraph here.");
    m!.surface.focus();
    selectText(m!.surface, "Second paragraph");
    await run();
    expect(synth.spoken.map((u) => u.text)).toEqual(["Second paragraph"]);
  });

  it("with no selection reads from the caret", async () => {
    setup("First one.\n\nSecond one.");
    m!.surface.focus();
    caretAfter(m!.surface, "Second");
    await run();
    expect(synth.spoken[0].text).toBe("one.");
  });

  it("a caret at the end of the text reads from the top", async () => {
    setup("First one.\n\nSecond one.");
    m!.surface.focus();
    caretAfter(m!.surface, "Second one.");
    await run();
    expect(synth.spoken[0].text).toBe("First one.");
  });

  it("splits a long block into pieces under the limit, at sentence ends", async () => {
    const long = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i + 1} of the long block.`).join(" ");
    setup(long, { maxChunk: 120 });
    await run();
    const said: string[] = [];
    while (synth.current) {
      said.push(synth.current.text);
      expect(synth.current.text.length).toBeLessThanOrEqual(120);
      synth.finish();
      await tick();
    }
    expect(said.length).toBeGreaterThan(3);
    expect(said.join(" ")).toBe(long);
    for (const s of said) expect(s.endsWith(".")).toBe(true);
  });

  it("says so when there is nothing to read", async () => {
    setup("");
    m!.surface.focus();
    await run();
    expect(synth.spoken.length).toBe(0);
    expect(error()).toBe("There is no text to read.");
  });

  it("leaves inline atoms out and keeps getValue untouched", async () => {
    setup("A $x^2$ b.");
    const before = m!.ed.getValue();
    await run();
    expect(synth.spoken[0].text.replace(/\s+/g, " ")).toBe("A b.");
    expect(m!.ed.getValue()).toBe(before);
  });

  it("in the Markdown pane speaks the text without syntax", async () => {
    setup("# Heading\n\nSome *emphasis* here", {}, { mode: "markdown" });
    await textareaReady(m!);
    await run();
    expect(synth.spoken.map((u) => u.text)).toEqual(["Heading"]);
    await endAll();
    expect(synth.spoken.map((u) => u.text)).toEqual(["Heading", "Some emphasis here"]);
    expect(hl().size).toBe(0);
  });
});

describe("read aloud: utterance settings", () => {
  it("language: option, else the block's lang, else the editor's", async () => {
    setup("Hello", { lang: "de-DE", rate: 1.5, pitch: 0.5 });
    await run();
    expect(synth.spoken[0]).toMatchObject({ lang: "de-DE", rate: 1.5, pitch: 0.5 });
    m!.ed.exec("readAloudStop");
    await tick();
    m!.host.setAttribute("lang", "fr");
    synth.spoken.length = 0;
    m!.destroy();
    setup("Hello", {});
    m!.host.setAttribute("lang", "es");
    await run();
    expect(synth.spoken[0].lang).toBe("es");
  });

  it("picks a voice for the language, or the named one, or the one a function returns", async () => {
    synth.voices = [{ name: "Anna", lang: "de-DE" }, { name: "Sam", lang: "en-US" }];
    setup("Hello", { lang: "en-US" });
    await run();
    expect((synth.spoken[0].voice as any).name).toBe("Sam");
    m!.destroy();
    setup("Hello", { lang: "en-US", voice: "Anna" });
    await run();
    expect((synth.spoken[synth.spoken.length - 1].voice as any).name).toBe("Anna");
    m!.destroy();
    setup("Hello", { lang: "en-US", voice: (vs) => vs[0] });
    await run();
    expect((synth.spoken[synth.spoken.length - 1].voice as any).name).toBe("Anna");
    m!.destroy();
    synth.voices = [];
    setup("Hello", { lang: "ja" });
    await run();
    expect(synth.spoken[synth.spoken.length - 1].voice).toBeNull();
  });

  it("clamps rate and pitch", async () => {
    setup("Hello", { rate: 99, pitch: -4 });
    await run();
    expect(synth.spoken[0]).toMatchObject({ rate: 10, pitch: 0 });
  });
});

describe("read aloud: highlighting", () => {
  it("highlights the block, then the word of each boundary event, with names per editor", async () => {
    setup("The quick brown fox.");
    await run();
    expect(text(named("-block")[0][1])).toBe("The quick brown fox.");
    expect(named("-word").length).toBe(0);
    synth.word("quick");
    expect(text(named("-word")[0][1])).toBe("quick");
    synth.word("fox.");
    expect(text(named("-word")[0][1])).toBe("fox.");
    const m1 = m!;
    const name1 = named("-word")[0][0];
    const other = mount({ value: "Another editor", plugins: [createReadAloudPlugin()] });
    other.ed.exec("readAloud");
    await tick();
    expect(named("-block").length).toBe(2);
    other.destroy();
    expect(named("-block").length).toBe(1);
    expect(m1).toBe(m);
    expect(name1).toMatch(/^atm-speech-\d+-word$/);
  });

  it("works when the engine sends no boundary events (block highlight only) and when charLength is missing", async () => {
    setup("Alpha beta gamma.");
    await run();
    expect(named("-block").length).toBe(1);
    expect(named("-word").length).toBe(0);
    synth.current!.onboundary!({ name: "word", charIndex: 6 });
    expect(text(named("-word")[0][1])).toBe("beta");
    synth.current!.onboundary!({ name: "sentence", charIndex: 0 });
    expect(text(named("-word")[0][1])).toBe("beta");
    synth.current!.onboundary!({ name: "word", charIndex: 9999 });
    expect(named("-word").length).toBe(0);
  });

  it("injects ::highlight rules per editor and removes them with the editor", async () => {
    setup("Hello there");
    await run();
    const st = document.head.querySelector("style[data-atm-speech-highlight]")!;
    expect(st.textContent).toMatch(/::highlight\(atm-speech-\d+-word\)/);
    expect(st.textContent).toContain("--atm-mark-bg");
    m!.destroy();
    m = null;
    expect(document.head.querySelector("style[data-atm-speech-highlight]")).toBeNull();
    expect(hl().size).toBe(0);
  });

  it("falls back to overlay boxes without the Highlight API", async () => {
    delete (window as any).Highlight;
    setup("The quick brown fox.");
    await run();
    const ov = m!.ed.element.querySelector(".atm-speech-overlay")!;
    expect(ov.getAttribute("aria-hidden")).toBe("true");
    expect(m!.surface.contains(ov)).toBe(false);
    expect(hl().size).toBe(0);
    m!.destroy();
    m = null;
  });

  it("highlightApi: false forces the overlay", async () => {
    setup("The quick brown fox.", { highlightApi: false });
    await run();
    expect(hl().size).toBe(0);
    expect(m!.ed.element.querySelector(".atm-speech-overlay")).not.toBeNull();
  });

  it("does not change the surface DOM or getValue", async () => {
    setup("The quick brown fox.");
    const html = m!.surface.innerHTML;
    await run();
    synth.word("quick");
    expect(m!.surface.innerHTML).toBe(html);
    expect(m!.ed.getValue().trim()).toBe("The quick brown fox.");
  });
});

describe("read aloud: controls", () => {
  it("pause and resume through the command and the button, with names that change", async () => {
    setup("Hello there");
    await run();
    const pause = panel().querySelector<HTMLButtonElement>('[data-id="pause"]')!;
    expect(pause.textContent).toBe("Pause reading");
    pause.click();
    expect(synth.paused).toBe(true);
    expect(status()).toBe("Paused");
    expect(panel().querySelector('[data-id="pause"]')!.textContent).toBe("Resume reading");
    expect(panel().querySelector('[data-id="pause"]')!.getAttribute("aria-pressed")).toBe("true");
    m!.ed.exec("readAloudPause");
    expect(synth.paused).toBe(false);
    expect(status()).toBe("Reading…");
  });

  it("stop button, command and Escape cancel speech and clear the highlight", async () => {
    setup("Hello there. More text.\n\nSecond.");
    await run();
    expect(hl().size).toBeGreaterThan(0);
    panel().querySelector<HTMLButtonElement>('[data-id="stop"]')!.click();
    await tick();
    expect(synth.cancelled).toBeGreaterThan(0);
    expect(hl().size).toBe(0);
    expect(status()).toBe("Stopped");
    expect(panel().querySelector(".atm-speech-buttons .atm-speech-btn")).toBeNull();
    await run();
    expect(pressKey(m!.surface, "Escape").defaultPrevented).toBe(true);
    await tick();
    expect(status()).toBe("Stopped");
    expect(pressKey(m!.surface, "Escape").defaultPrevented).toBe(false);
  });

  it("the toggle command stops when speaking; a canceled utterance does not advance or error", async () => {
    setup("One.\n\nTwo.");
    await run();
    m!.ed.exec("readAloud");
    await tick();
    expect(status()).toBe("Stopped");
    expect(error()).toBe("");
    expect(synth.spoken.length).toBe(1);
  });

  it("editing or switching mode stops reading", async () => {
    setup("One.\n\nTwo.");
    await run();
    m!.ed.setMode("markdown");
    await tick();
    expect(status()).toBe("Stopped");
  });

  it("destroy cancels speech and removes everything", async () => {
    setup("One.\n\nTwo.");
    await run();
    const c = synth.cancelled;
    const el = m!.ed.element;
    m!.destroy();
    m = null;
    expect(synth.cancelled).toBeGreaterThan(c);
    expect(el.querySelector(".atm-speech-dock, .atm-speech-overlay")).toBeNull();
    synth.spoken[0].onend?.({});
    expect(synth.spoken.length).toBe(1);
  });

  it("restarting while speaking ignores the old utterance's events", async () => {
    setup("One.\n\nTwo.");
    await run();
    const first = synth.spoken[0];
    m!.ed.exec("readAloud");
    await run();
    first.onend?.({});
    await tick();
    expect(synth.spoken.length).toBe(2);
  });

  it("an engine error is reported in the alert and stops", async () => {
    setup("One.\n\nTwo.");
    await run();
    synth.current!.onerror!({ error: "synthesis-failed" });
    expect(error()).toMatch(/could not speak/);
    expect(panel().querySelector(".atm-speech-error")!.getAttribute("role")).toBe("alert");
    expect(status()).toBe("");
  });

  it("is available in a read-only editor through the command", async () => {
    setup("Read only text", {}, { readOnly: true });
    await run();
    expect(synth.spoken[0].text).toBe("Read only text");
  });
});

describe("read aloud: feature detection", () => {
  it("without speechSynthesis the command explains, the item is disabled and nothing throws", async () => {
    uninstall();
    const p = createReadAloudPlugin();
    const item = p.toolbar![0];
    expect(item.label).toMatch(/not supported/i);
    m = mount({ value: "Hello", plugins: [p] });
    expect(item.isEnabled!(m.ed)).toBe(false);
    expect(() => m!.ed.exec("readAloud")).not.toThrow();
    expect(error()).toMatch(/not supported/i);
    expect(() => m!.ed.exec("readAloudPause")).not.toThrow();
    installSynthesis();
  });

  it("needs the utterance class too", () => {
    delete (window as any).SpeechSynthesisUtterance;
    const p = createReadAloudPlugin();
    expect(p.toolbar![0].label).toMatch(/not supported/i);
    (window as any).SpeechSynthesisUtterance = FakeUtterance;
  });

  it("with the API the item is an enabled toggle with a shortcut", () => {
    const p = createReadAloudPlugin();
    m = mount({ value: "Hello", plugins: [p] });
    const item = p.toolbar![0];
    expect(item).toMatchObject({ type: "toggle", label: "Read aloud", shortcut: "Mod-Shift-," });
    expect(item.isEnabled!(m.ed)).toBe(true);
    expect(p.keymap).toEqual({ "Mod-Shift-,": "readAloud" });
  });

  it("a throwing speak is reported, not thrown", async () => {
    synth.speak = () => {
      throw new Error("boom");
    };
    setup("Hello");
    expect(() => m!.ed.exec("readAloud")).not.toThrow();
    expect(error()).toMatch(/could not speak/);
  });

  it("a throwing getVoices is tolerated", async () => {
    synth.getVoices = () => {
      throw new Error("no");
    };
    setup("Hello");
    await run();
    expect(synth.spoken.length).toBe(1);
  });
});
void vi;
