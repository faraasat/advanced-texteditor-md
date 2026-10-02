import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser/index";
import { renderDom, renderHtml } from "../../../src/render/index";
import {
  addDays,
  createDateChips,
  daysBetween,
  findDateTrigger,
  formatIsoDate,
  isIsoDate,
  parseIsoDate,
  relativeIsoDate,
  toIsoDate,
} from "../../../src/extensions/blocks/dates";
import { caretAfter, mount, setSel, textareaReady, tick, typeInto, type Mounted } from "../../plugins/helpers";
import { enter } from "./helpers";

const TODAY = () => new Date(2026, 9, 2, 15, 30); // local 2026-10-02

describe("dates: pure helpers", () => {
  it("parseIsoDate accepts real calendar dates only", () => {
    expect(parseIsoDate("2026-10-02")).toEqual({ y: 2026, m: 10, d: 2 });
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("1900-02-29")).toBe(false);
    expect(isIsoDate("2000-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-04-31")).toBe(false);
    expect(isIsoDate("0000-01-01")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate("2026-10-02T00:00")).toBe(false);
    expect(isIsoDate(" 2026-10-02")).toBe(false);
    expect(isIsoDate(20261002)).toBe(false);
  });
  it("toIsoDate uses the local calendar date", () => {
    expect(toIsoDate(TODAY())).toBe("2026-10-02");
    expect(toIsoDate(new Date(2026, 0, 1, 0, 0, 1))).toBe("2026-01-01");
    expect(toIsoDate(new Date(NaN))).toBeNull();
  });
  it("formatIsoDate formats in UTC (never shifts a day) and falls back to the text", () => {
    expect(formatIsoDate("2026-10-02", "en-US")).toBe("Oct 2, 2026");
    expect(formatIsoDate("2026-10-02", "de-DE", { day: "numeric", month: "long", year: "numeric" })).toBe("2. Oktober 2026");
    expect(formatIsoDate("2026-02-31", "en-US")).toBe("2026-02-31");
    expect(formatIsoDate("2026-10-02", "xx-invalid-locale-!!")).toBe("2026-10-02");
    expect(formatIsoDate("0099-01-01", "en-US", { year: "numeric" })).toBe("99");
  });
  it("daysBetween, addDays and relative words", () => {
    expect(daysBetween("2026-10-02", "2026-10-03")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(relativeIsoDate("2026-10-03", "2026-10-02", "en")).toBe("tomorrow");
    expect(relativeIsoDate("2026-10-02", "2026-10-02", "en")).toBe("today");
    expect(relativeIsoDate("2026-10-09", "2026-10-02", "en")).toBeNull();
    expect(relativeIsoDate("2026-10-05", "2026-10-02", "en", 3)).toBe("in 3 days");
  });
  it("findDateTrigger needs a word start and ignores case", () => {
    const t = { today: "@today", tomorrow: "@tomorrow" as const };
    expect(findDateTrigger("meet @today", t)).toEqual({ start: 5, key: "today" });
    expect(findDateTrigger("@Today", t)).toEqual({ start: 0, key: "today" });
    expect(findDateTrigger("x@today", t)).toBeNull();
    expect(findDateTrigger("(@tomorrow", t)).toEqual({ start: 1, key: "tomorrow" });
    expect(findDateTrigger("@today", { today: false })).toBeNull();
  });
});

describe("dates: rendering", () => {
  const d = createDateChips({ locale: "en-US", today: TODAY });
  it("renders a <time datetime> with the formatted date; the stored Markdown is untouched", () => {
    const md = "Due [2026-10-02](date:2026-10-02).";
    const html = renderHtml(md, { chips: [d.chip] });
    expect(html).toContain('<time datetime="2026-10-02">Oct 2, 2026</time>');
    expect(html).toContain('data-scheme="date"');
    expect(stringify(parse(md, { chipSchemes: ["date"] }))).toBe(md);
  });
  it("a typed label is shown as typed", () => {
    const html = renderHtml("[Launch day](date:2026-10-02)", { chips: [d.chip] });
    expect(html).toContain('<time datetime="2026-10-02">Launch day</time>');
  });
  it("relative labels", () => {
    const r = createDateChips({ locale: "en-US", today: TODAY, relative: true });
    expect(renderHtml("[2026-10-03](date:2026-10-03)", { chips: [r.chip] })).toContain(">tomorrow</time>");
    expect(renderHtml("[2026-11-03](date:2026-11-03)", { chips: [r.chip] })).toContain(">Nov 3, 2026</time>");
  });
  it("an invalid id renders the plain label, escaped, without a <time>", () => {
    for (const id of ["2026-02-31", "tomorrow", "%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E"]) {
      const frag = renderDom(`[<b>x</b>](date:${id})`, { chips: [d.chip] });
      const box = document.createElement("div");
      box.appendChild(frag);
      expect(box.querySelector("time")).toBeNull();
      expect(box.querySelector("b, img")).toBeNull();
      expect(box.querySelector(".atm-chip")!.textContent).toBe("<b>x</b>");
    }
  });
});

describe("dates: editing", () => {
  let m: Mounted;
  afterEach(() => m?.destroy());
  const mk = (value = "", extra: Parameters<typeof createDateChips>[0] = {}) => {
    const d = createDateChips({ locale: "en-US", today: TODAY, ...extra });
    m = mount({ value, plugins: [d.plugin], chips: [d.chip] });
    return d;
  };
  const dialog = () => m.ed.element.querySelector<HTMLElement>(".atm-date-pop");

  it("typing @today then Space makes today's chip", async () => {
    mk("Meet ");
    caretAfter(m.surface, "Meet ");
    await typeInto(m.surface, "@today ");
    expect(m.ed.getValue()).toBe("Meet [2026-10-02](date:2026-10-02)");
    const chip = m.surface.querySelector(".atm-chip-date")!;
    expect(chip.querySelector("time")!.getAttribute("datetime")).toBe("2026-10-02");
    expect(chip.textContent).toBe("Oct 2, 2026");
    await typeInto(m.surface, "ok");
    expect(m.ed.getValue()).toBe("Meet [2026-10-02](date:2026-10-02) ok");
  });

  it("@today then Enter converts and still starts a new paragraph", async () => {
    mk("x");
    caretAfter(m.surface, "x");
    await typeInto(m.surface, " @today");
    await enter(m.surface);
    expect(m.ed.getValue()).toBe("x [2026-10-02](date:2026-10-02)");
    expect(m.surface.querySelectorAll("p")).toHaveLength(2);
  });

  it("not inside code, not mid-word, not during an IME composition", async () => {
    mk("`code` word");
    caretAfter(m.surface, "cod");
    await typeInto(m.surface, "@today ");
    expect(m.ed.getValue()).not.toContain("date:");
    caretAfter(m.surface, "word");
    await typeInto(m.surface, "@today ");
    expect(m.ed.getValue()).not.toContain("date:");
    m.destroy();
    mk("a ");
    caretAfter(m.surface, "a ");
    await typeInto(m.surface, "@today");
    const t = m.surface.querySelector("p")!.firstChild as Text;
    t.insertData(t.data.length, " ");
    setSel(t, t.data.length);
    m.surface.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", data: " ", bubbles: true }));
    await tick();
    expect(m.ed.getValue()).not.toContain("date:");
  });

  it("insertDate with an ISO string, a Date, nothing (today) and garbage", () => {
    mk("");
    m.surface.focus();
    setSel(m.surface.querySelector("p")!, 0);
    expect(m.ed.exec("insertDate", "2026-12-24")).toBe(true);
    expect(m.ed.exec("insertDate", new Date(2027, 0, 5))).toBe(true);
    expect(m.ed.exec("insertDate")).toBe(true);
    expect(m.ed.exec("insertDate", "2026-02-30")).toBe(false);
    expect(m.ed.exec("insertDate", "javascript:alert(1)")).toBe(false);
    expect(m.ed.getValue()).toBe("[2026-12-24](date:2026-12-24) [2027-01-05](date:2027-01-05) [2026-10-02](date:2026-10-02)");
  });

  it("clicking a chip opens the picker; Set replaces the chip in one undo step; Today works; Escape cancels", async () => {
    mk("On [2026-10-02](date:2026-10-02) we ship");
    const before = m.ed.getValue();
    const chip = () => m.surface.querySelector<HTMLElement>(".atm-chip-date")!;
    chip().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const d = dialog()!;
    expect(d.getAttribute("role")).toBe("dialog");
    const input = d.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(input.value).toBe("2026-10-02");
    expect(document.activeElement).toBe(input);
    expect(m.surface.contains(d)).toBe(false);
    input.value = "2026-11-15";
    d.querySelector<HTMLButtonElement>(".atm-btn-primary")!.click();
    expect(dialog()).toBeNull();
    expect(m.ed.getValue()).toBe("On [2026-11-15](date:2026-11-15) we ship");
    m.ed.undo();
    expect(m.ed.getValue()).toBe(before);
    chip().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    dialog()!.querySelector<HTMLInputElement>("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dialog()).toBeNull();
    expect(m.ed.getValue()).toBe(before);
    m.ed.setValue("On [2025-01-01](date:2025-01-01)");
    chip().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    dialog()!.querySelector<HTMLButtonElement>(".atm-btn-secondary")!.click();
    expect(m.ed.getValue()).toBe("On [2026-10-02](date:2026-10-02)");
  });

  it("Enter in the picker applies; an empty or impossible value is refused", () => {
    mk("[2026-10-02](date:2026-10-02)");
    m.surface.querySelector<HTMLElement>(".atm-chip-date")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = dialog()!.querySelector<HTMLInputElement>("input")!;
    input.value = "";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(dialog()).not.toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    input.value = "2026-10-20";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(m.ed.getValue()).toBe("[2026-10-20](date:2026-10-20)");
  });

  it("the /date slash item inserts today and opens the picker", () => {
    const d = mk("");
    m.surface.focus();
    setSel(m.surface.querySelector("p")!, 0);
    d.plugin.slash![0].run(m.ed);
    expect(m.ed.getValue()).toBe("[2026-10-02](date:2026-10-02)");
    expect(dialog()).not.toBeNull();
  });

  it("read-only: no picker", () => {
    const d = createDateChips({ today: TODAY });
    m = mount({ value: "[2026-10-02](date:2026-10-02)", readOnly: true, plugins: [d.plugin], chips: [d.chip] });
    m.surface.querySelector<HTMLElement>(".atm-chip-date")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(dialog()).toBeNull();
  });

  it("Markdown mode: @today + Space converts in the source", async () => {
    const d = createDateChips({ today: TODAY });
    m = mount({ value: "", mode: "markdown", plugins: [d.plugin], chips: [d.chip] });
    const ta = await textareaReady(m);
    ta.focus();
    ta.value = "go @today ";
    ta.setSelectionRange(10, 10);
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: " ", bubbles: true }));
    await tick();
    expect(m.ed.getValue()).toBe("go [2026-10-02](date:2026-10-02) ");
  });
});
