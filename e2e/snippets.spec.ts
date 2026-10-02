import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * advanced-texteditor-md/snippets in a real browser: typed triggers (Space, Tab), Backspace revert,
 * {{cursor}} and {{selection}}, the slash menu's Templates group, the palette and its picker by
 * keyboard, the Markdown pane, import and export, and axe on the picker in both colour schemes.
 *
 *   npm run build
 *   npx playwright test e2e/snippets.spec.ts
 */

const URL = "/example/snippets.html";

test.beforeAll(() => {
  if (!existsSync(join(process.cwd(), "dist/snippets.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type W = {
  __editor: { getValue(): string; setValue(s: string): void; exec(c: string, a?: unknown): boolean };
  __snippets: { insert(ed: unknown, id: string): Promise<boolean> };
};

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL + "?" + new URLSearchParams(params).toString());
  await page.waitForFunction(() => !!(window as unknown as W).__editor);
  return { errors };
}
const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const textarea = (page: Page) => page.locator("#editor-host textarea");
const value = (page: Page) => page.evaluate(() => (window as unknown as W).__editor.getValue().trimEnd());
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
const axe = async (page: Page, sel: string) => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const r = await new AxeBuilder({ page }).include(sel).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`);
};
const picker = (page: Page) => page.locator(".atm-snip-picker");

/** Focus the editor with the caret at the end of its text. */
async function caretToEnd(page: Page) {
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    root.focus();
    const r = document.createRange();
    r.selectNodeContents(root.lastElementChild!);
    r.collapse(false);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
}
/** Replace the document and put the caret at the end of the last block. */
async function fresh(page: Page, md: string) {
  await page.evaluate((x) => (window as unknown as W).__editor.setValue(x), md);
  await caretToEnd(page);
}
async function openPaletteAndPicker(page: Page) {
  await page.keyboard.press(`${await mod(page)}+Shift+KeyP`);
  const input = page.locator("#editor-host .atm-palette input[role=combobox]");
  await expect(input).toBeFocused();
  await page.keyboard.type("insert template");
  await page.keyboard.press("Enter");
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).locator("input[role=combobox]")).toBeFocused();
}

test.describe("typed triggers in the WYSIWYG surface", () => {
  test("the trigger and Space expand it; Backspace puts the trigger back; the stored Markdown is clean", async ({ page }) => {
    const { errors } = await open(page);
    await fresh(page, "Regards,");
    await page.keyboard.press("Enter");
    await page.keyboard.type(";sig ");
    await expect.poll(() => value(page)).toBe("Regards,\n\nAda Lovelace");
    // Backspace straight after an expansion: the typed trigger is back, in one step.
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("Regards,\n\n;sig");
    // and the next space is an ordinary space, so the trigger can stay as text
    await page.keyboard.type(" ok");
    await expect.poll(() => value(page)).toBe("Regards,\n\n;sig ok");
    expect(errors).toEqual([]);
  });

  test("the whole expansion is ONE undo step", async ({ page }) => {
    await open(page);
    await fresh(page, "Hi ");
    await page.keyboard.type(";date ");
    await expect.poll(() => value(page)).toMatch(/^Hi \d{4}-\d{2}-\d{2}$/);
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe("Hi ;date");
    await page.keyboard.press(`${await mod(page)}+Shift+z`);
    await expect.poll(() => value(page)).toMatch(/^Hi \d{4}-\d{2}-\d{2}$/);
  });

  test("{{cursor}} puts the caret inside the text", async ({ page }) => {
    await open(page);
    await fresh(page, "");
    await page.keyboard.type(";ty ");
    await expect.poll(() => value(page)).toBe("Thank you, !");
    await page.keyboard.type("Grace");
    await expect.poll(() => value(page)).toBe("Thank you, Grace!");
  });

  test("Tab expands and is consumed; elsewhere Tab is untouched", async ({ page }) => {
    await open(page);
    await fresh(page, "");
    await page.keyboard.type(";sig");
    await page.keyboard.press("Tab");
    await expect.poll(() => value(page)).toBe("Ada Lovelace");
    await expect(surface(page)).toBeFocused();
    await expect(surface(page).locator("p")).toHaveCount(1);
  });

  test("a block snippet becomes real blocks and the caret lands at {{cursor}}", async ({ page }) => {
    await open(page);
    await fresh(page, "");
    await page.keyboard.type(";meet ");
    await expect(surface(page).locator("h2")).toHaveText("Meeting notes: Project Alpha");
    await expect(surface(page).locator("li")).toHaveCount(2);
    await page.keyboard.type("Agreed the plan");
    const v = await value(page);
    expect(v).toContain("### Notes\n\nAgreed the plan\n\n### Actions");
    expect(v).toMatch(/\*\*Date:\*\* \d{4}-\d{2}-\d{2}/);
    await page.keyboard.press(`${await mod(page)}+z`);
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe(";meet");
  });

  test("not inside inline code, and not in the middle of a word", async ({ page }) => {
    await open(page);
    await fresh(page, "a `code` b");
    await page.evaluate(() => {
      const code = document.querySelector("#editor-host .atm-surface code")!.firstChild!;
      const r = document.createRange();
      r.setStart(code, code.textContent!.length);
      r.collapse(true);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await page.keyboard.type(" ;sig ");
    await expect.poll(() => value(page)).not.toContain("Ada");
    await caretToEnd(page);
    await page.keyboard.type("x;sig ");
    await expect.poll(() => value(page)).not.toContain("Ada");
  });

  test("an async host variable inserts once it has arrived", async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const w = window as unknown as { __snippets: { store: { upsert(s: unknown): Promise<unknown> } } };
      await w.__snippets.store.upsert({ id: "mood", name: "Mood", trigger: ";mood", scope: "inline", body: "Feeling {{mood}}." });
    });
    await fresh(page, "");
    await page.keyboard.type(";mood ");
    await expect.poll(() => value(page)).toBe("Feeling cheerful.");
  });
});

test.describe("the slash menu and the palette", () => {
  test("the Templates group lists block snippets with a preview; Enter inserts", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "the slash menu's preview column needs a wide fine pointer");
    await open(page);
    await fresh(page, "");
    await page.keyboard.type("/");
    const menu = page.locator(".atm-slash-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Templates", { exact: true })).toBeVisible();
    await page.keyboard.type("weekly");
    await expect(menu.getByRole("option", { name: /Weekly status/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(surface(page).locator("h2")).toHaveText("Status for Project Alpha");
    await page.keyboard.type("shipped it");
    await expect.poll(() => value(page)).toContain("- **Done:** shipped it");
  });

  test("on a narrow screen the slash menu still lists Templates", async ({ page }) => {
    await open(page);
    await fresh(page, "");
    await page.keyboard.type("/templ");
    const menu = page.locator(".atm-slash-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option", { name: /Insert template/ })).toBeVisible();
  });

  test("the palette's “Insert template…” opens a keyboard-operable picker; {{selection}} is wrapped", async ({ page }) => {
    const { errors } = await open(page);
    await fresh(page, "Please quote this sentence now.");
    await page.evaluate(() => {
      const t = document.querySelector("#editor-host .atm-surface p")!.firstChild as Text;
      const i = t.data.indexOf("this sentence");
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + "this sentence".length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await openPaletteAndPicker(page);
    const dlg = picker(page);
    await expect(dlg).toHaveAttribute("role", "dialog");
    const input = dlg.locator("input[role=combobox]");
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await expect(dlg.locator("[role=option]")).toHaveCount(7);
    expect(await axe(page, ".atm-snip-picker")).toEqual([]);
    await page.keyboard.type("quote");
    await expect(dlg.locator("[role=option]")).toHaveCount(1);
    await expect(input).toHaveAttribute("aria-activedescendant", /atm-snip-\d+-opt-0/);
    await page.keyboard.press("Enter");
    await expect(dlg).toHaveCount(0);
    await expect(surface(page)).toBeFocused();
    await expect.poll(() => value(page)).toContain("> this sentence");
    await page.keyboard.type("Ada");
    await expect.poll(() => value(page)).toContain("> Ada");
    expect(errors).toEqual([]);
  });

  test("Escape closes the picker and returns focus and the caret to the editor", async ({ page }) => {
    await open(page);
    await fresh(page, "Hello");
    await openPaletteAndPicker(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(picker(page)).toHaveCount(0);
    await expect(surface(page)).toBeFocused();
    await page.keyboard.type("!");
    await expect.poll(() => value(page)).toBe("Hello!");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe on the picker, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, scheme === "dark" ? { theme: "dark", page: "dark" } : {});
      await fresh(page, "x");
      await page.evaluate(() => (window as unknown as W).__editor.exec("plugin:snippets:picker"));
      await expect(picker(page)).toBeVisible();
      await page.keyboard.type("meet");
      await expect(picker(page).locator(".atm-snip-preview")).toBeVisible();
      expect(await axe(page, ".atm-snip-picker")).toEqual([]);
    });
  }
});

test.describe("the Markdown pane", () => {
  test("the body goes in verbatim, with the caret at {{cursor}}; Backspace reverts", async ({ page }) => {
    await open(page, { mode: "markdown", value: "" });
    const ta = textarea(page);
    await ta.click();
    await page.keyboard.type(";meet ");
    await expect.poll(() => value(page)).toContain("## Meeting notes: Project Alpha\n\n**Date:** ");
    const v = await ta.inputValue();
    expect(v).toContain("### Notes\n\n\n\n### Actions");
    expect(await ta.evaluate((e: HTMLTextAreaElement) => e.value.slice(0, e.selectionStart).endsWith("### Notes\n\n"))).toBe(true);
    await page.keyboard.press("Backspace");
    await expect(ta).toHaveValue(";meet ");
  });

  test("Tab expands a trigger at the caret", async ({ page }) => {
    await open(page, { mode: "markdown", value: "" });
    await textarea(page).click();
    await page.keyboard.type("by ;sig");
    await page.keyboard.press("Tab");
    await expect(textarea(page)).toHaveValue("by Ada Lovelace");
  });
});

test.describe("import and export", () => {
  test("export, edit, import (merge) and the new trigger works; replace drops what the file lacks", async ({ page }) => {
    const { errors } = await open(page);
    await page.getByRole("button", { name: "Export JSON" }).click();
    const text = await page.locator("#json").inputValue();
    const data = JSON.parse(text);
    expect(data.format).toBe("advanced-texteditor-md/snippets");
    expect(data.version).toBe(1);
    expect(data.snippets.length).toBe(7);

    // merge: one new snippet, one changed, one invalid
    const edited = JSON.stringify({
      ...data,
      snippets: [
        { id: "hello", name: "Hello", trigger: ";hi", scope: "inline", body: "Hello from {{project}}" },
        { ...data.snippets.find((s: { id: string }) => s.id === "sig"), body: "{{user}} (edited)" },
        { id: "bad id", name: "Broken", body: "x" },
      ],
    });
    await page.locator("#json").fill(edited);
    await page.getByRole("button", { name: "Import (merge)" }).click();
    const report = JSON.parse((await page.locator("#report").textContent())!);
    expect(report).toMatchObject({ mode: "merge", added: ["hello"], updated: ["sig"], removed: [], applied: true });
    expect(report.skipped).toEqual(["2: bad-id"]);
    await expect(page.locator("#snip-table tbody tr")).toHaveCount(8);
    await fresh(page, "");
    await page.keyboard.type(";hi ");
    await expect.poll(() => value(page)).toBe("Hello from Project Alpha");
    await page.keyboard.type(";sig ");
    await expect.poll(() => value(page)).toBe("Hello from Project Alpha Ada Lovelace (edited)");

    // round trip: exporting again gives the changed list, importing it as a replace changes nothing
    await page.getByRole("button", { name: "Export JSON" }).click();
    const again = await page.locator("#json").inputValue();
    await page.getByRole("button", { name: "Import (replace)" }).click();
    const r2 = JSON.parse((await page.locator("#report").textContent())!);
    expect(r2).toMatchObject({ mode: "replace", added: [], removed: [], applied: true });
    expect(r2.updated.length).toBe(8);
    await page.getByRole("button", { name: "Export JSON" }).click();
    expect(await page.locator("#json").inputValue()).toBe(again);

    // a replace with a smaller file removes the rest
    await page.locator("#json").fill(JSON.stringify({ ...JSON.parse(again), snippets: JSON.parse(again).snippets.slice(0, 2) }));
    await page.getByRole("button", { name: "Import (replace)" }).click();
    await expect(page.locator("#snip-table tbody tr")).toHaveCount(2);
    await fresh(page, "");
    await page.keyboard.type(";ty ");
    await expect.poll(() => value(page)).toBe(";ty");

    // a file that is not JSON changes nothing
    await page.locator("#json").fill("{ nope");
    await page.getByRole("button", { name: "Import (replace)" }).click();
    await expect(page.locator("#report")).toContainText("bad-json");
    await expect(page.locator("#snip-table tbody tr")).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("with storage=local the list survives a reload", async ({ page }) => {
    await open(page, { storage: "local" });
    await page.evaluate(() => localStorage.removeItem("atm-demo-snippets"));
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as W).__editor);
    await page.evaluate(async () => {
      const w = window as unknown as { __snippets: { store: { upsert(s: unknown): Promise<unknown> } } };
      await w.__snippets.store.upsert({ id: "kept", name: "Kept", trigger: ";kept", scope: "inline", body: "still here" });
    });
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as W).__editor);
    await fresh(page, "");
    await page.keyboard.type(";kept ");
    await expect.poll(() => value(page)).toBe("still here");
    await page.evaluate(() => localStorage.removeItem("atm-demo-snippets"));
  });
});

test.describe("layout", () => {
  test("the picker fits a phone and mirrors in right-to-left", async ({ page }) => {
    await open(page, { dir: "rtl" });
    await fresh(page, "x");
    await page.evaluate(() => (window as unknown as W).__editor.exec("plugin:snippets:picker"));
    const dlg = picker(page);
    await expect(dlg).toBeVisible();
    const box = (await dlg.boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await axe(page, ".atm-snip-picker")).toEqual([]);
  });
});
