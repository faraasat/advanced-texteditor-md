import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * advanced-texteditor-md/tasks in a real browser. Runs against example/tasks.html (the BUILT library),
 * with today fixed at 2026-10-02.
 *
 *   npm run build            (once)
 *   npx playwright test e2e/tasks.spec.ts
 */
const URL = "/example/tasks.html";

test.beforeAll(() => {
  if (!existsSync(join(process.cwd(), "dist/tasks.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type W = { __editor: { getValue(): string; setValue(s: string): void; exec(c: string, a?: unknown): boolean; setReadOnly(b: boolean): void } };

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL + "?" + new URLSearchParams({ today: "2026-10-02", ...params }).toString());
  await page.waitForFunction(() => !!(window as unknown as W).__editor);
  return { errors };
}
const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const value = (page: Page) => page.evaluate(() => (window as unknown as W).__editor.getValue().trimEnd());
const setValue = (page: Page, v: string) => page.evaluate((x) => (window as unknown as W).__editor.setValue(x), v);
const exec = (page: Page, c: string, a?: unknown) => page.evaluate(([c_, a_]) => (window as unknown as W).__editor.exec(c_ as string, a_), [c, a] as const);
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const axe = async (page: Page, sel: string) => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  return new AxeBuilder({ page }).include(sel).analyze();
};
const chip = (iso: string) => `[${iso}](date:${iso})`;

/** Caret at the end of the text of the task whose text starts with `text`. */
async function caretInTask(page: Page, text: string) {
  await page.evaluate((t) => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    const li = [...root.querySelectorAll("li")].find((l) => (l.querySelector(":scope > p")?.textContent ?? "").startsWith(t))!;
    const p = li.querySelector(":scope > p")!;
    root.focus();
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  }, text);
}

const LIST = "- [x] a\n- [ ] b\n  - [x] b1\n  - [ ] b2\n- [x] c\n- [ ] d";

test.describe("due dates", () => {
  test("set from code: one chip at the end, overdue is a decoration and never stored, undo is one step", async ({ page }) => {
    const { errors } = await open(page, { value: "- [ ] Write spec\n- [ ] Review" });
    await caretInTask(page, "Write spec");
    expect(await exec(page, "setDueDate", "2026-10-01")).toBe(true);
    await expect.poll(() => value(page)).toBe(`- [ ] Write spec ${chip("2026-10-01")}\n- [ ] Review`);
    const c = surface(page).locator(".atm-chip-date").first();
    await expect(c).toHaveAttribute("data-atm-due", "overdue");
    await expect(c).toHaveAttribute("aria-description", "Overdue, yesterday");
    expect(await value(page)).not.toContain("overdue");
    // A second call replaces, it does not add.
    await exec(page, "setDueDate", "2026-10-05");
    await expect.poll(() => value(page)).toBe(`- [ ] Write spec ${chip("2026-10-05")}\n- [ ] Review`);
    await expect(surface(page).locator(".atm-chip-date")).toHaveCount(1);
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe(`- [ ] Write spec ${chip("2026-10-01")}\n- [ ] Review`);
    expect(errors).toEqual([]);
  });

  test("the native date picker: open, pick, Set", async ({ page }) => {
    await open(page, { value: "- [ ] Write spec" });
    await caretInTask(page, "Write spec");
    expect(await exec(page, "setDueDate")).toBe(true);
    const dlg = page.getByRole("dialog", { name: "Due date" });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel("Date").fill("2026-10-05");
    await dlg.getByRole("button", { name: "Set" }).click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(() => value(page)).toBe(`- [ ] Write spec ${chip("2026-10-05")}`);
    // Focus is back in the editor.
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("#editor-host .atm-surface"))).toBe(true);
  });

  test("Escape closes the picker without a change; Remove clears the date", async ({ page }) => {
    await open(page, { value: `- [ ] Write spec ${chip("2026-10-05")}` });
    await caretInTask(page, "Write spec");
    await exec(page, "setDueDate");
    const dlg = page.getByRole("dialog", { name: "Due date" });
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect.poll(() => value(page)).toBe(`- [ ] Write spec ${chip("2026-10-05")}`);
    await caretInTask(page, "Write spec");
    await exec(page, "setDueDate");
    await page.getByRole("dialog", { name: "Due date" }).getByRole("button", { name: "Remove" }).click();
    await expect.poll(() => value(page)).toBe("- [ ] Write spec");
  });

  test("keyboard shortcut Mod-Alt-Shift-D opens the picker", async ({ page }) => {
    test.skip(isMobile(page), "no hardware keyboard on a phone");
    await open(page, { value: "- [ ] Write spec" });
    await caretInTask(page, "Write spec");
    await page.keyboard.press(`${await mod(page)}+Alt+Shift+KeyD`);
    await expect(page.getByRole("dialog", { name: "Due date" })).toBeVisible();
  });
});

test.describe("assignees", () => {
  test("assign puts the caret at the end of the item and the mention menu picks a person", async ({ page }) => {
    await open(page, { value: "- [ ] Write spec\n- [ ] Review" });
    await caretInTask(page, "Write spec");
    expect(await exec(page, "assignTask")).toBe(true);
    await page.keyboard.type("Gra");
    await expect(page.getByRole("option", { name: /Grace Hopper/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toBe("- [ ] Write spec [@Grace Hopper](mention:person/grace)\n- [ ] Review");
    await expect.poll(() => page.locator("#output-sum").innerText()).toContain('"label": "Grace Hopper"');
  });

  test("keyboard shortcut Mod-Alt-Shift-A", async ({ page }) => {
    test.skip(isMobile(page), "no hardware keyboard on a phone");
    await open(page, { value: "- [ ] Write spec" });
    await caretInTask(page, "Write spec");
    await page.keyboard.press(`${await mod(page)}+Alt+Shift+KeyA`);
    await page.keyboard.type("Ada");
    await expect(page.getByRole("option", { name: /Ada Lovelace/ })).toBeVisible();
  });
});

test.describe("progress block", () => {
  const MD = "::: progress\n1 of 3 tasks done (33%)\n:::\n\n- [x] a\n- [ ] b\n- [ ] c";
  test("a checkbox click updates the stored sentence and the bar, and one undo restores both", async ({ page }) => {
    const { errors } = await open(page, { value: MD });
    const bar = surface(page).locator(".atm-custom-progress");
    await expect(bar).toHaveAttribute("data-atm-progress", "33");
    await surface(page).getByRole("checkbox").nth(1).click();
    await expect.poll(() => value(page)).toBe("::: progress\n2 of 3 tasks done (67%)\n:::\n\n- [x] a\n- [x] b\n- [ ] c");
    await expect(bar).toHaveAttribute("data-atm-progress", "67");
    await surface(page).focus();
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe(MD);
    await expect(bar).toHaveAttribute("data-atm-progress", "33");
    expect(errors).toEqual([]);
  });

  test("Mod-Enter toggles the task and the sentence together", async ({ page }) => {
    test.skip(isMobile(page), "no hardware keyboard on a phone");
    await open(page, { value: MD });
    await caretInTask(page, "c");
    await page.keyboard.press(`${await mod(page)}+Enter`);
    await expect.poll(() => value(page)).toBe("::: progress\n2 of 3 tasks done (67%)\n:::\n\n- [x] a\n- [ ] b\n- [x] c");
  });

  test("a new task fixes the sentence a moment later", async ({ page }) => {
    await open(page, { value: MD });
    await caretInTask(page, "c");
    await page.keyboard.press("Enter");
    await page.keyboard.type("d");
    await expect.poll(() => value(page), { timeout: 4000 }).toContain("1 of 4 tasks done (25%)");
  });

  test("the section block counts its own section", async ({ page }) => {
    await open(page);
    await expect(surface(page).locator(".atm-custom-progress").nth(1)).toHaveAttribute("data-atm-progress", "0");
    await expect(surface(page).locator(".atm-custom-progress").nth(0)).toHaveAttribute("data-atm-progress", "33");
  });

  test("the Add progress block button inserts a true block", async ({ page }) => {
    await open(page, { value: "- [x] a\n- [ ] b" });
    await caretInTask(page, "b");
    await page.getByRole("button", { name: "Add progress block" }).click();
    await expect.poll(() => value(page)).toBe("- [x] a\n- [ ] b\n\n::: progress\n1 of 2 tasks done (50%)\n:::");
  });
});

test.describe("move completed", () => {
  test("one list, then every list, each undone in one step", async ({ page }) => {
    await open(page, { value: LIST });
    await caretInTask(page, "d");
    await page.getByRole("button", { name: "Move completed (this list)" }).click();
    await expect.poll(() => value(page)).toBe("- [ ] b\n  - [x] b1\n  - [ ] b2\n- [ ] d\n- [x] a\n- [x] c");
    await page.getByRole("button", { name: "Move completed (every list)" }).click();
    await expect.poll(() => value(page)).toBe("- [ ] b\n  - [ ] b2\n  - [x] b1\n- [ ] d\n- [x] a\n- [x] c");
    await surface(page).focus();
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe("- [ ] b\n  - [x] b1\n  - [ ] b2\n- [ ] d\n- [x] a\n- [x] c");
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe(LIST);
  });

  test("keyboard shortcut Mod-Alt-Shift-M", async ({ page }) => {
    test.skip(isMobile(page), "no hardware keyboard on a phone");
    await open(page, { value: LIST });
    await caretInTask(page, "d");
    await page.keyboard.press(`${await mod(page)}+Alt+Shift+KeyM`);
    await expect.poll(() => value(page)).toBe("- [ ] b\n  - [x] b1\n  - [ ] b2\n- [ ] d\n- [x] a\n- [x] c");
  });

  test("in the Markdown pane it edits the text", async ({ page }) => {
    await open(page, { value: LIST });
    await page.evaluate(() => (window as unknown as { __editor: { setMode(m: string): void } }).__editor.setMode("markdown"));
    const ta = page.locator("#editor-host textarea");
    await expect(ta).toBeVisible();
    await ta.evaluate((t: HTMLTextAreaElement) => {
      t.focus();
      const i = t.value.lastIndexOf("d");
      t.setSelectionRange(i, i);
    });
    expect(await exec(page, "moveCompleted")).toBe(true);
    await expect(ta).toHaveValue("- [ ] b\n  - [x] b1\n  - [ ] b2\n- [ ] d\n- [x] a\n- [x] c");
  });
});

test.describe("filter", () => {
  test("in the read-only view: Open / Done / Overdue hide by class, announce, and leave the document alone", async ({ page }) => {
    const { errors } = await open(page);
    const view = page.locator("#view");
    const status = view.getByRole("status");
    await expect(status).toHaveText("Showing 9 of 9 tasks");
    await view.getByRole("button", { name: "Open" }).click();
    await expect(view.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
    await expect(status).toHaveText("Showing 6 of 9 tasks");
    await expect(view.locator("li.atm-task-hidden")).toHaveCount(2);
    await view.getByRole("button", { name: "Overdue" }).click();
    await expect(status).toHaveText("Showing 1 of 9 tasks");
    await expect(view.locator("li.atm-task:not(.atm-task-hidden)")).toHaveCount(1);
    await view.getByRole("button", { name: "All" }).click();
    await expect(view.locator(".atm-task-hidden")).toHaveCount(0);
    expect(await value(page)).toContain("[ ] Review the pricing page");
    expect(errors).toEqual([]);
  });

  test("the read-only editor shows the same control, and editing again removes it", async ({ page }) => {
    await open(page, { readonly: "1" });
    const ctl = page.locator("#editor-host .atm-tasks-filter");
    await expect(ctl).toBeVisible();
    await ctl.getByRole("button", { name: "Done" }).click();
    await expect(surface(page).locator("li.atm-task:not(.atm-task-hidden)")).toHaveCount(3);
    await page.getByRole("button", { name: "Read-only" }).click();
    await expect(ctl).toHaveCount(0);
    await expect(surface(page).locator(".atm-task-hidden")).toHaveCount(0);
  });
});

test.describe("appearance and accessibility", () => {
  test("axe: light editor, view and the open picker", async ({ page }) => {
    await open(page);
    expect((await axe(page, "#editor-host")).violations).toEqual([]);
    expect((await axe(page, "#view")).violations).toEqual([]);
    await caretInTask(page, "Plan the retro");
    await exec(page, "setDueDate");
    await expect(page.getByRole("dialog", { name: "Due date" })).toBeVisible();
    expect((await axe(page, "#editor-host")).violations).toEqual([]);
  });

  test("axe: dark theme, read-only with the filter", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, { theme: "dark", readonly: "1" });
    expect((await axe(page, "#editor-host")).violations).toEqual([]);
    expect((await axe(page, "#view")).violations).toEqual([]);
  });

  test("RTL: the bar fills from the right", async ({ page }) => {
    await open(page, { dir: "rtl" });
    const pos = await surface(page).locator(".atm-custom-progress").first().evaluate((e) => getComputedStyle(e, "::before").backgroundPosition);
    expect(pos).toMatch(/^100% 0(%|px)/);
  });
});
