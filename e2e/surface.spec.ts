/**
 * Real-browser behaviour of the WYSIWYG surface: caret, Enter/Backspace,
 * IME, paste, drag-drop. Runs against example/surface.html with a bundle
 * built from src (esbuild) before the tests.
 */
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test.beforeAll(() => {
  const bin = resolve(ROOT, "node_modules/.bin/esbuild");
  const entry = [
    'export { createSurface } from "./src/editor/surface";',
    'export { createMathRenderer } from "./src/math/index";',
    'export { createHighlighter } from "./src/highlight/index";',
    'export { default as javascript } from "./src/highlight/langs/javascript";',
  ].join("\n");
  execFileSync(bin, ["--bundle", "--format=esm", "--loader=ts", "--sourcefile=surface-entry.ts", `--outfile=${resolve(ROOT, "example/dist-surface.js")}`, "--log-level=error"], {
    cwd: ROOT,
    input: entry,
  });
  if (!existsSync(resolve(ROOT, "example/dist-surface.js"))) throw new Error("bundle missing");
});

async function open(page: Page, md = "", extra = "") {
  await page.goto(`/example/surface.html?md=${encodeURIComponent(md)}${extra}`);
  await page.waitForFunction(() => (window as unknown as { surfaceReady?: boolean }).surfaceReady === true);
  const ed = page.getByRole("textbox", { name: "Editor" });
  await ed.click();
  return ed;
}

const value = (page: Page) => page.evaluate(() => (window as unknown as { surface: { getValue(): string } }).surface.getValue());

/** Put the caret at the end of the editor content. */
async function toEnd(page: Page) {
  await page.keyboard.press("ControlOrMeta+End");
}

async function caretAfter(page: Page, text: string) {
  await page.evaluate((needle) => {
    const root = document.querySelector(".atm-surface")!;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = (n as Text).data.indexOf(needle);
      if (i >= 0) {
        document.getSelection()!.collapse(n, i + needle.length);
        return;
      }
    }
    throw new Error("not found " + needle);
  }, text);
}

async function selectText(page: Page, from: string, to = from) {
  await page.evaluate(
    ([a, b]) => {
      const root = document.querySelector(".atm-surface")!;
      const find = (needle: string) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const i = (n as Text).data.indexOf(needle);
          if (i >= 0) return { n, i };
        }
        throw new Error("not found " + needle);
      };
      const s = find(a);
      const e = find(b);
      document.getSelection()!.setBaseAndExtent(s.n, s.i, e.n, e.i + b.length);
    },
    [from, to],
  );
}

test.describe("surface", () => {
  test("typing and block input rules", async ({ page }) => {
    await open(page);
    await page.keyboard.type("## Title");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("two");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("1. first");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("> quoted");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("[ ] task");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("---");
    await page.keyboard.press("Enter");
    await page.keyboard.type("end");
    await expect.poll(() => value(page)).toBe("## Title\n\n- one\n- two\n\n1. first\n\n> quoted\n\n- [ ] task\n\n---\n\nend");
  });

  test("inline input rules and autolink", async ({ page }) => {
    await open(page);
    await page.keyboard.type("a **bold** b *em* c ~~del~~ d `code` e $x^2$ f [link](https://x.com) g https://example.com h");
    await expect.poll(() => value(page)).toBe("a **bold** b *em* c ~~del~~ d `code` e $x^2$ f [link](https://x.com) g https://example.com h");
    await expect(page.locator(".atm-surface strong")).toHaveText("bold");
    await expect(page.locator(".atm-surface .atm-math")).toHaveCount(1);
    await expect(page.locator(".atm-surface a")).toHaveCount(2);
  });

  test("remaining input rules: underscore marks, image, custom syntax, $$ block", async ({ page }) => {
    await open(page);
    await page.keyboard.type("x __b__ _e_ ==m== ![pic](https://x.com/a.png) y");
    await expect.poll(() => value(page)).toBe("x **b** *e* ==m== ![pic](https://x.com/a.png) y");
    await expect(page.locator(".atm-surface mark")).toHaveText("m");
    await expect(page.locator(".atm-surface img")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await page.keyboard.type("$$");
    await page.keyboard.press("Enter");
    await page.keyboard.type("E=mc^2");
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toBe("x **b** *e* ==m== ![pic](https://x.com/a.png) y\n\n$$\nE=mc^2\n$$");
    await expect(page.locator(".atm-surface .atm-math-block math")).toHaveCount(1);
  });

  test("select all, then type or delete", async ({ page }) => {
    await open(page, "# a\n\n- b\n- c\n\n| x |\n| --- |\n| 1 |\n\nend");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("new");
    await expect.poll(() => value(page)).toBe("new");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("");
    await page.keyboard.type("again");
    await expect.poll(() => value(page)).toBe("again");
  });

  test("Enter in the middle of bold text, then typing", async ({ page }) => {
    await open(page, "**abcd** e");
    await caretAfter(page, "ab");
    await page.keyboard.press("Enter");
    await page.keyboard.type("X");
    await expect.poll(() => value(page)).toBe("**ab**\n\n**Xcd** e");
  });

  test("typing after a chip at the end of a block", async ({ page }) => {
    await open(page, "see [@Jane](mention:person/u1)");
    await page.locator(".atm-surface p").click({ position: { x: 300, y: 5 } });
    await page.keyboard.press("End");
    await page.keyboard.type(" ok");
    await expect.poll(() => value(page)).toBe("see [@Jane](mention:person/u1) ok");
  });

  test("a rule is one undo step that brings the typed characters back", async ({ page }) => {
    await open(page);
    await page.keyboard.type("# ");
    await expect(page.locator(".atm-surface h1")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".atm-surface h1")).toHaveCount(0);
    await expect(page.locator(".atm-surface")).toHaveText("# ");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.locator(".atm-surface h1")).toHaveCount(1);
  });

  test("typing is grouped in history; redo works", async ({ page }) => {
    await open(page);
    await page.keyboard.type("hello");
    await page.waitForTimeout(700);
    await page.keyboard.type(" world");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => value(page)).toBe("hello");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => value(page)).toBe("");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => value(page)).toBe("hello world");
  });

  test("Enter / Backspace / Tab in lists", async ({ page }) => {
    await open(page, "- a\n- b");
    await caretAfter(page, "b");
    await page.keyboard.press("Tab");
    await expect.poll(() => value(page)).toBe("- a\n  - b");
    await page.keyboard.press("Enter");
    await page.keyboard.type("c");
    await expect.poll(() => value(page)).toBe("- a\n  - b\n  - c");
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => value(page)).toBe("- a\n  - b\n- c");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("- a\n  - b\n\nc");
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("- a\n  - bc");
  });

  test("Tab leaves the editor when not in a list or table", async ({ page }) => {
    await open(page, "plain");
    await page.keyboard.press("Tab");
    await expect(page.locator("#outside")).toBeFocused();
  });

  test("Shift+Enter inserts a hard break, Enter on heading end makes a paragraph", async ({ page }) => {
    await open(page, "# Head");
    await toEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("line1");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("line2");
    await expect.poll(() => value(page)).toBe("# Head\n\nline1\\\nline2");
  });

  test("chips: insert, arrow over, one Backspace removes", async ({ page }) => {
    await open(page, "hi");
    await caretAfter(page, "hi");
    await page.keyboard.type(" ");
    await page.evaluate(() =>
      (window as unknown as { surface: { insertChip(c: object): void } }).surface.insertChip({ scheme: "mention", kind: "person", id: "u1", label: "Jane", trigger: "@" }),
    );
    await page.keyboard.type("x");
    await expect.poll(() => value(page)).toBe("hi [@Jane](mention:person/u1) x");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("Y");
    await expect.poll(() => value(page)).toBe("hi Y[@Jane](mention:person/u1) x");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("hi Y x");
    await expect(page.locator(".atm-chip")).toHaveCount(0);
  });

  test("chip click and copy as markdown", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await open(page, "a [@Jane](mention:person/u1) b");
    await page.locator(".atm-chip").click();
    expect(await page.evaluate(() => (window as unknown as { chipClicks: string[] }).chipClicks)).toEqual(["u1"]);
    const md = await page.evaluate(() => {
      const dt = new DataTransfer();
      const r = document.createRange();
      r.selectNode(document.querySelector(".atm-chip")!);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(r);
      document.querySelector(".atm-surface")!.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true }));
      return dt.getData("text/plain");
    });
    expect(md).toBe("[@Jane](mention:person/u1)");
  });

  test("paste HTML, markdown and files", async ({ page }) => {
    await open(page);
    const paste = (data: Record<string, string>, file?: string) =>
      page.evaluate(
        ([d, f]) => {
          const dt = new DataTransfer();
          for (const [k, v] of Object.entries(d as Record<string, string>)) dt.setData(k, v);
          if (f) dt.items.add(new File(["x"], f as string, { type: "image/png" }));
          document.querySelector(".atm-surface")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        },
        [data, file] as const,
      );
    await paste({ "text/html": "<p>Hello <b>bold</b><script>window.pwned=1</script><img src=x onerror=\"window.pwned=2\"></p>", "text/plain": "Hello bold" });
    await expect.poll(() => value(page)).toBe("Hello **bold**");
    expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
    await page.keyboard.press("Enter");
    await paste({ "text/plain": "# T\n\n- a\n- b" });
    await expect.poll(() => value(page)).toBe("Hello **bold**\n\n# T\n\n- a\n- b");
    await paste({}, "shot.png");
    expect(await page.evaluate(() => (window as unknown as { files: unknown[] }).files)).toEqual([{ names: ["shot.png"], source: "paste" }]);
  });

  test("drag-drop a file", async ({ page }) => {
    await open(page, "x");
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "doc.pdf", { type: "application/pdf" }));
      const r = document.querySelector(".atm-surface")!.getBoundingClientRect();
      document.querySelector(".atm-surface")!.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
    });
    expect(await page.evaluate(() => (window as unknown as { files: unknown[] }).files)).toEqual([{ names: ["doc.pdf"], source: "drop" }]);
  });

  test("internal drag moves the selected text", async ({ page }) => {
    await open(page, "one two three");
    await selectText(page, "two ");
    await page.evaluate(() => {
      const root = document.querySelector(".atm-surface")!;
      const dt = new DataTransfer();
      dt.setData("text/plain", "two ");
      root.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
      const t = root.querySelector("p")!.firstChild as Text;
      const r = document.createRange();
      r.setStart(t, t.data.length);
      r.collapse(true);
      const rect = r.getClientRects()[0] ?? r.getBoundingClientRect();
      root.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: rect.right + 1, clientY: rect.top + rect.height / 2 }));
    });
    await expect.poll(() => value(page)).toBe("one threetwo");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => value(page)).toBe("one two three");
  });

  test("task toggling", async ({ page }) => {
    await open(page, "- [ ] a\n- [x] b");
    await page.locator(".atm-task-box").first().click();
    await expect.poll(() => value(page)).toBe("- [x] a\n- [x] b");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => value(page)).toBe("- [ ] a\n- [x] b");
  });

  test("tables: Tab navigation, new row at the end, Enter in last cell", async ({ page }) => {
    await open(page);
    await page.keyboard.type("| a | b |");
    await page.keyboard.press("Enter");
    await page.keyboard.type("1");
    await page.keyboard.press("Tab");
    await page.keyboard.type("2");
    await page.keyboard.press("Tab");
    await page.keyboard.type("3");
    await page.keyboard.press("Enter");
    await page.keyboard.type("4");
    await page.keyboard.press("Enter");
    await page.keyboard.type("5");
    await expect.poll(() => value(page)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 |  |");
  });

  test("code block: Enter adds lines, double Enter exits, highlighting keeps the caret", async ({ page }) => {
    await open(page);
    await page.keyboard.type("```js");
    await page.keyboard.press("Enter");
    await page.keyboard.type("let a = 1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("const b");
    await page.waitForTimeout(400);
    await page.keyboard.type(" = 2");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("after");
    await expect.poll(() => value(page)).toBe("```js\nlet a = 1\nconst b = 2\n```\n\nafter");
    await expect(page.locator(".atm-surface .atm-tok-keyword").first()).toHaveText("let");
  });

  test("math atom: click to edit, Enter commits", async ({ page }) => {
    await open(page, "area $r^2$ end");
    await page.locator(".atm-surface .atm-math").click();
    await expect(page.locator("[data-atm-math-edit]")).toBeVisible();
    await page.keyboard.type("\\pi r^2");
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toBe("area $\\pi r^2$ end");
    await expect(page.locator(".atm-surface .atm-math math")).toHaveCount(1);
  });

  test("selection is preserved across commands", async ({ page }) => {
    await open(page, "one two three");
    await selectText(page, "two");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("ControlOrMeta+i");
    await expect.poll(() => value(page)).toBe("one ***two*** three");
    expect(await page.evaluate(() => document.getSelection()!.toString())).toBe("two");
    await page.keyboard.press("ControlOrMeta+Alt+2");
    await expect.poll(() => value(page)).toBe("## one ***two*** three");
    expect(await page.evaluate(() => document.getSelection()!.toString())).toBe("two");
  });

  test("Backspace at start of a heading / quote lifts it; selection delete across blocks", async ({ page }) => {
    await open(page, "## h\n\n> q\n\nabc\n\ndef");
    await caretAfter(page, "q");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("## h\n\nq\n\nabc\n\ndef");
    await selectText(page, "bc", "de");
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("## h\n\nq\n\naf");
  });

  test("IME composition commits once", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP only");
    await open(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.imeSetComposition", { text: "にほ", selectionStart: 2, selectionEnd: 2 });
    expect(await page.evaluate(() => (window as unknown as { inputs: string[] }).inputs)).toEqual([]);
    await cdp.send("Input.insertText", { text: "日本" });
    await expect.poll(() => value(page)).toBe("日本");
    await page.keyboard.type(" ok");
    await expect.poll(() => value(page)).toBe("日本 ok");
  });

  test("placeholder and read-only", async ({ page }) => {
    await open(page);
    await expect(page.locator(".atm-surface")).toHaveAttribute("data-empty", "");
    await page.keyboard.type("x");
    await expect(page.locator(".atm-surface")).not.toHaveAttribute("data-empty", "");
    await open(page, "- [ ] a", "&ro=1");
    await expect(page.locator(".atm-surface")).toHaveAttribute("contenteditable", "false");
    await page.locator(".atm-task-box").click({ force: true });
    await expect.poll(() => value(page)).toBe("- [ ] a");
  });

  test("maxLength blocks typing but allows deleting", async ({ page }) => {
    await open(page, "abc", "&max=5");
    await toEnd(page);
    await page.keyboard.type("defg");
    await expect.poll(() => value(page)).toBe("abcde");
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("abcd");
  });
});
