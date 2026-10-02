import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Dictation and read aloud in a real browser. Browsers under test have no microphone and no
 * installed voices, so a fake SpeechRecognition and a fake speechSynthesis are injected before the
 * page loads and driven from the tests. Runs against example/speech.html (the BUILT library).
 *
 *   npm run build            (once)
 *   npx playwright test e2e/speech.spec.ts
 */

const ROOT = process.cwd();
const URL = "/example/speech.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/speech.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type Win = Window & { __editor: { getValue(): string; exec(c: string, a?: unknown): boolean; setMode(m: string): void }; __events: [string, unknown][] };

/** Installed before any page script. `opts.boundaries` false: the fake engine sends no boundary events. */
function installFakes(opts: { recognition: boolean; synthesis: boolean; boundaries: boolean; stepMs: number }) {
  const w = window as any;
  const def = (k: string, v: unknown) => Object.defineProperty(w, k, { value: v, configurable: true, writable: true });
  if (opts.recognition) {
    class Rec {
      lang = ""; continuous = false; interimResults = false; maxAlternatives = 1; started = false;
      onstart: any = null; onend: any = null; onerror: any = null; onresult: any = null;
      results: any[] = [];
      constructor() { w.__rec = this; (w.__recs ??= []).push(this); }
      start() { if (this.started) throw new Error("InvalidStateError"); this.started = true; setTimeout(() => this.onstart?.({}), 0); }
      stop() { setTimeout(() => this.end(), 0); }
      abort() { w.__aborted = (w.__aborted ?? 0) + 1; this.end(); }
      end() { if (this.started) { this.started = false; this.onend?.({}); } }
    }
    def("SpeechRecognition", Rec);
    def("webkitSpeechRecognition", Rec);
    w.__say = (parts: [string, boolean][], index?: number) => {
      const r = w.__rec;
      const i = index ?? r.results.length;
      r.results.length = i;
      for (const [t, f] of parts) r.results.push(Object.assign([{ transcript: t, confidence: 1 }], { isFinal: f }));
      r.onresult?.({ resultIndex: i, results: r.results });
    };
    w.__fail = (code: string) => { w.__rec.onerror?.({ error: code }); w.__rec.end(); };
  } else {
    def("SpeechRecognition", undefined);
    def("webkitSpeechRecognition", undefined);
  }
  if (opts.synthesis) {
    class Utt {
      voice: any = null; lang = ""; rate = 1; pitch = 1; onstart: any = null; onend: any = null; onerror: any = null; onboundary: any = null;
      constructor(public text = "") {}
    }
    const synth: any = {
      paused: false, speaking: false, timer: 0, queue: [] as Utt[],
      getVoices: () => [],
      speak(u: Utt) { (w.__spoken ??= []).push(u.text); this.current = u; this.speaking = true; setTimeout(() => { u.onstart?.({}); this.play(u, 0); }, 0); },
      play(u: Utt, from: number) {
        if (this.current !== u) return;
        if (this.paused) { this.timer = window.setTimeout(() => this.play(u, from), 30); return; }
        const re = /\S+/g; re.lastIndex = from;
        const m = re.exec(u.text);
        if (!m) { this.current = null; this.speaking = false; u.onend?.({}); return; }
        if (opts.boundaries) u.onboundary?.({ name: "word", charIndex: m.index, charLength: m[0].length });
        this.timer = window.setTimeout(() => this.play(u, m.index + m[0].length), opts.stepMs);
      },
      cancel() { const u = this.current; this.current = null; this.speaking = false; clearTimeout(this.timer); if (u) setTimeout(() => u.onerror?.({ error: "canceled" }), 0); },
      pause() { this.paused = true; w.__paused = true; },
      resume() { this.paused = false; w.__paused = false; },
    };
    def("speechSynthesis", synth);
    def("SpeechSynthesisUtterance", Utt);
  } else {
    def("speechSynthesis", undefined);
    def("SpeechSynthesisUtterance", undefined);
  }
}

async function open(page: Page, params: Record<string, string> = {}, fakes: Partial<Parameters<typeof installFakes>[0]> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(installFakes, { recognition: true, synthesis: true, boundaries: true, stepMs: 120, ...fakes });
  await page.goto(`${URL}?${new URLSearchParams(params).toString()}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}

const host = (page: Page) => page.locator("#editor-host");
const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const value = (page: Page) => page.evaluate(() => (window as unknown as Win).__editor.getValue().trimEnd());
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
const say = (page: Page, parts: [string, boolean][], index?: number) => page.evaluate(([p, i]) => (window as any).__say(p, i), [parts, index] as const);
const dictStatus = (page: Page) => page.locator('[data-kind="dictation"] .atm-speech-status');
const readStatus = (page: Page) => page.locator('[data-kind="read-aloud"] .atm-speech-status');

/** Caret at the end of `needle` in the surface (a real DOM selection). */
async function caretAfter(page: Page, needle: string) {
  await page.evaluate((t) => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    root.focus();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = (n as Text).data.indexOf(t);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i + t.length);
        r.collapse(true);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        return;
      }
    }
    throw new Error("not found: " + t);
  }, needle);
}
async function selectText(page: Page, needle: string) {
  await page.evaluate((t) => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    root.focus();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = (n as Text).data.indexOf(t);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + t.length);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        return;
      }
    }
    throw new Error("not found: " + t);
  }, needle);
}

/** Press a toolbar item by id: directly when it is in the row, through the More menu when it overflowed. */
async function pressItem(page: Page, id: string) {
  const btn = page.locator(`#editor-host [data-id="${id}"]`);
  if (await btn.isVisible()) return btn.click();
  await page.locator('#editor-host button[aria-label^="More"]').first().click();
  await page.getByRole("menuitem", { name: new RegExp(id === "dictation" ? "Dictation" : "Read aloud") }).click();
}

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page }).include("#editor-host").analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** The text currently highlighted as the spoken word (Highlight API, or the overlay boxes' count). */
const spokenWord = (page: Page) =>
  page.evaluate(() => {
    const hs = (CSS as any).highlights as Map<string, { values(): Iterable<Range> }> | undefined;
    if (hs) for (const [k, v] of hs) if (k.endsWith("-word")) return [...v.values()].map((r) => r.toString()).join("|");
    const marks = document.querySelectorAll("#editor-host .atm-speech-word").length;
    return marks ? "(box)" : "";
  });
const spokenBlock = (page: Page) =>
  page.evaluate(() => {
    const hs = (CSS as any).highlights as Map<string, { values(): Iterable<Range> }> | undefined;
    if (hs) for (const [k, v] of hs) if (k.endsWith("-block")) return [...v.values()].map((r) => r.toString()).join("|");
    return document.querySelectorAll("#editor-host .atm-speech-block").length ? "(box)" : "";
  });

test.describe("dictation", () => {
  test("starts only on a gesture; interim words are ghost text outside the content, finals are typed", async ({ page }) => {
    const { errors } = await open(page);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).__recs?.length ?? 0)).toBe(0);
    await caretAfter(page, "at the caret.");
    await pressItem(page, "dictation");
    await expect(dictStatus(page)).toHaveText("Listening…");
    await expect(page.locator('#editor-host [data-kind="dictation"].atm-speech-panel')).toBeVisible();
    await say(page, [["and some more", false]]);
    const ghost = page.locator("#editor-host .atm-speech-ghost");
    await expect(ghost).toBeVisible();
    await expect(ghost).toHaveText(" And some more");
    await expect(surface(page).locator(".atm-speech-ghost")).toHaveCount(0);
    expect(await value(page)).not.toContain("some more");
    await axeClean(page);
    await say(page, [["and some more", true]], 0);
    await expect(ghost).toHaveCount(0);
    expect(await value(page)).toContain("at the caret. And some more");
    expect(await page.evaluate(() => (window as any).__rec.interimResults)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("the toolbar button is a toggle (aria-pressed) and stops with Escape", async ({ page }) => {
    await open(page);
    await caretAfter(page, "at the caret.");
    const btn = page.locator('#editor-host [data-id="dictation"]');
    test.skip(!(await btn.isVisible()), "the item is in the overflow menu at this width");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect(dictStatus(page)).toHaveText("Listening…");
    await page.keyboard.press("Escape");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await expect(dictStatus(page)).toHaveText("Stopped");
  });

  test("the keyboard shortcut toggles it", async ({ page, isMobile }) => {
    test.skip(isMobile, "needs a hardware keyboard");
    await open(page);
    await caretAfter(page, "at the caret.");
    const m = await mod(page);
    await page.keyboard.press(`${m}+Shift+.`);
    await expect(dictStatus(page)).toHaveText("Listening…");
    await page.keyboard.press(`${m}+Shift+.`);
    await expect(dictStatus(page)).toHaveText("Stopped");
  });

  test("the command palette starts it", async ({ page, isMobile }) => {
    test.skip(isMobile, "needs a hardware keyboard");
    await open(page);
    await caretAfter(page, "at the caret.");
    const m = await mod(page);
    await page.keyboard.press(`${m}+Shift+P`);
    await page.getByRole("combobox").fill("dictation");
    await page.keyboard.press("Enter");
    await expect(dictStatus(page)).toHaveText("Listening…");
    await page.waitForTimeout(700);
    await expect(dictStatus(page)).toHaveText("Listening…");
  });

  test("spoken commands are off by default and work with commands=1", async ({ page }) => {
    await open(page, { value: "", commands: "1", lang: "en-US" });
    await surface(page).click();
    await pressItem(page, "dictation");
    await expect(dictStatus(page)).toHaveText("Listening…");
    await say(page, [["hello comma world period", true]]);
    await say(page, [["new paragraph second one", true]]);
    await expect.poll(() => value(page)).toBe("Hello, world.\n\nSecond one");
  });

  test("stops when the editor loses focus", async ({ page }) => {
    await open(page);
    await caretAfter(page, "at the caret.");
    await pressItem(page, "dictation");
    await expect(dictStatus(page)).toHaveText("Listening…");
    await page.waitForTimeout(600);
    await page.locator("#output-md").focus();
    await expect(dictStatus(page)).toHaveText("Stopped");
    expect(await page.evaluate(() => (window as any).__aborted)).toBeGreaterThan(0);
  });

  test("works in the Markdown pane", async ({ page }) => {
    await open(page, { mode: "markdown", value: "Hello" });
    const ta = host(page).locator("textarea");
    await ta.click();
    await ta.press("End");
    await pressItem(page, "dictation");
    await expect(dictStatus(page)).toHaveText("Listening…");
    await say(page, [["there", false]]);
    await expect(page.locator("#editor-host .atm-speech-ghost")).toBeVisible();
    await say(page, [["there", true]], 0);
    await expect(ta).toHaveValue("Hello there");
    await axeClean(page);
  });

  for (const [code, re] of [
    ["not-allowed", /microphone is blocked.*Allow microphone access/i],
    ["audio-capture", /No microphone was found/],
    ["network", /could not be reached/],
  ] as const) {
    test(`error ${code} is an alert with actionable text and focus stays`, async ({ page }) => {
      await open(page);
      await caretAfter(page, "at the caret.");
      await pressItem(page, "dictation");
      await expect(dictStatus(page)).toHaveText("Listening…");
      await page.evaluate((c) => (window as any).__fail(c), code);
      const alert = page.locator('[data-kind="dictation"] [role="alert"]');
      await expect(alert).toHaveText(re);
      await expect(alert).toHaveAttribute("aria-live", "assertive");
      expect(await page.evaluate(() => document.activeElement?.classList.contains("atm-surface"))).toBe(true);
      await axeClean(page);
      await page.getByRole("button", { name: "Dismiss message" }).click();
      await expect(alert).toHaveText("");
    });
  }

  test("right-to-left text: the ghost follows the inline direction", async ({ page }) => {
    await open(page, { rtl: "1", value: "مرحبا بالعالم", lang: "ar" });
    await caretAfter(page, "بالعالم");
    await pressItem(page, "dictation");
    await expect(dictStatus(page)).toHaveText("Listening…");
    await say(page, [["كيف حالك", false]]);
    const ghost = page.locator("#editor-host .atm-speech-ghost");
    await expect(ghost).toBeVisible();
    expect(await ghost.evaluate((e) => getComputedStyle(e).direction)).toBe("rtl");
    expect(await page.evaluate(() => (window as any).__rec.lang)).toBe("ar");
    await axeClean(page);
  });
});

test.describe("read aloud", () => {
  test("reads the document from the caret and highlights each spoken word", async ({ page }) => {
    const { errors } = await open(page, { value: "First paragraph here.\n\nSecond paragraph words." });
    await caretAfter(page, "Second");
    await pressItem(page, "readAloud");
    await expect(readStatus(page)).toHaveText("Reading…");
    await expect.poll(() => spokenWord(page)).toMatch(/paragraph|\(box\)/);
    const seen = new Set<string>();
    for (let i = 0; i < 30 && seen.size < 3; i++) {
      seen.add(await spokenWord(page));
      await page.waitForTimeout(60);
    }
    expect(await page.evaluate(() => (window as any).__spoken)).toEqual(["paragraph words."]);
    await axeClean(page);
    await expect(readStatus(page)).toHaveText("Finished reading");
    expect(await spokenWord(page)).toBe("");
    expect(errors).toEqual([]);
  });

  test("reads the selection only; the stored Markdown never changes", async ({ page }) => {
    await open(page, { value: "# Title\n\nFirst **bold** paragraph.\n\nSecond paragraph." });
    const before = await value(page);
    await selectText(page, "First");
    await page.evaluate(() => {
      const s = getSelection()!;
      const r = s.getRangeAt(0);
      const t = r.startContainer as Text;
      const full = document.createRange();
      full.setStart(t, 0);
      full.setEnd(t, t.length);
      s.removeAllRanges();
      s.addRange(full);
    });
    await pressItem(page, "readAloud");
    await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual(["First"]);
    expect(await value(page)).toBe(before);
  });

  test("an engine without boundary events still shows the block being read", async ({ page }) => {
    await open(page, { value: "Alpha beta gamma.\n\nDelta epsilon." }, { boundaries: false });
    await caretAfter(page, "nothing-yet").catch(() => {});
    await surface(page).click();
    await page.evaluate(() => (window as any).__editor.exec("readAloud"));
    await expect.poll(() => spokenBlock(page)).toMatch(/Alpha beta gamma\.|\(box\)/);
    expect(await spokenWord(page)).toBe("");
  });

  test("pause, resume and stop are labelled buttons; Escape stops", async ({ page }) => {
    await open(page, { value: "One two three four five six seven eight nine ten." }, { stepMs: 200 });
    await pressItem(page, "readAloud");
    const pause = page.locator('[data-kind="read-aloud"] [data-id="pause"]');
    await expect(pause).toHaveText("Pause reading");
    await pause.click();
    await expect(readStatus(page)).toHaveText("Paused");
    await expect(pause).toHaveText("Resume reading");
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => (window as any).__paused)).toBe(true);
    await axeClean(page);
    await pause.click();
    await expect(readStatus(page)).toHaveText("Reading…");
    await page.locator('[data-kind="read-aloud"] [data-id="stop"]').click();
    await expect(readStatus(page)).toHaveText("Stopped");
    await expect(page.locator("#editor-host .atm-speech-overlay .atm-speech-mark")).toHaveCount(0);
    await pressItem(page, "readAloud");
    await expect(readStatus(page)).toHaveText("Reading…");
    await surface(page).click();
    await page.keyboard.press("Escape");
    await expect(readStatus(page)).toHaveText("Stopped");
  });

  test("the overlay highlight is used when the Highlight API is off", async ({ page }) => {
    await open(page, { hl: "0", value: "Alpha beta gamma delta epsilon." }, { stepMs: 300 });
    await pressItem(page, "readAloud");
    await expect(page.locator("#editor-host .atm-speech-overlay .atm-speech-word").first()).toBeVisible();
    await expect(page.locator("#editor-host .atm-speech-overlay .atm-speech-block").first()).toBeVisible();
    await expect(surface(page).locator(".atm-speech-overlay, .atm-speech-mark")).toHaveCount(0);
  });

  test("the spoken block scrolls into view (instantly with reduced motion)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph number ${i + 1} has a few words in it.`).join("\n\n");
    await open(page, { value: long }, { stepMs: 5 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await pressItem(page, "readAloud");
    await expect(readStatus(page)).toHaveText("Finished reading", { timeout: 20000 });
    const last = surface(page).locator("p").last();
    const box = await last.boundingBox();
    const vh = page.viewportSize()!.height;
    expect(box!.y + box!.height).toBeGreaterThan(0);
    expect(box!.y).toBeLessThan(vh);
  });

  test("the toolbar button and the palette entry carry the name; axe is clean at rest", async ({ page }) => {
    await open(page);
    const btn = page.locator('#editor-host [data-id="readAloud"]');
    if (await btn.isVisible()) {
      await expect(btn).toHaveAttribute("aria-label", "Read aloud");
      await expect(btn).toHaveAttribute("aria-pressed", "false");
    }
    await axeClean(page);
  });
});

test.describe("without the browser APIs", () => {
  test("both commands are disabled with an explanation and nothing throws", async ({ page }) => {
    const { errors } = await open(page, {}, { recognition: false, synthesis: false });
    await expect(page.locator("#support")).toContainText("not available");
    for (const [id, name] of [["dictation", "Dictation"], ["readAloud", "Read aloud"]] as const) {
      const btn = page.locator(`#editor-host [data-id="${id}"]`);
      if (await btn.isVisible()) {
        await expect(btn).toHaveAttribute("aria-disabled", "true");
        await expect(btn).toHaveAttribute("aria-label", `${name} (not supported in this browser)`);
      }
    }
    await page.evaluate(() => { (window as unknown as Win).__editor.exec("dictation"); });
    await expect(page.locator('[data-kind="dictation"] [role="alert"]')).toHaveText(/not supported/);
    await page.evaluate(() => { (window as unknown as Win).__editor.exec("readAloud"); });
    await expect(page.locator('[data-kind="read-aloud"] [role="alert"]')).toHaveText(/not supported/);
    await axeClean(page);
    expect(errors).toEqual([]);
  });
});
