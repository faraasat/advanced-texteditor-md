import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLinkManager } from "../../../src/extensions/links/manager";
import { createWikiLinks } from "../../../src/extensions/links/wiki";
import { caretAtEnd, mount, wait, type Mounted } from "../../plugins/helpers";
import { cleanupBody, mountMd, until } from "../chips/md-helpers";

const open: Mounted[] = [];
beforeAll(async () => {
  await import("../../../src/extensions/links/manager-ui");
  await import("../../../src/editor/markdown-pane");
});
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.querySelectorAll("[data-atm-links]").forEach((e) => e.remove());
  cleanupBody();
});
const keep = (m: Mounted) => (open.push(m), m);

const MD = [
  "Intro [secure](https://example.com/a) and [plain](http://example.com/b) and [bad](javascript:alert(1)).",
  "",
  "Pages: [Alpha plan](wiki:p1) and [Gone](wiki:gone).",
  "",
  "![logo](http://cdn.example.com/logo.png) <http://example.org/c> and http://example.net/d",
].join("\n");

const resolve = async (ids: string[]) => Object.fromEntries(ids.map((i) => [i, { exists: i !== "gone" }]));
const dialog = () => document.querySelector<HTMLElement>("[data-atm-links] [role=dialog]");
const rowsOf = () => Array.from(document.querySelectorAll<HTMLElement>(".atm-links-row"));
const statuses = () => rowsOf().map((r) => r.getAttribute("data-status"));
const btn = (name: RegExp | string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("[data-atm-links] button")).find((b) => (typeof name === "string" ? b.textContent === name : name.test(b.getAttribute("aria-label") ?? b.textContent ?? "")))!;
const live = () => document.querySelector(".atm-links-live")?.textContent;

async function setup(extra: Parameters<typeof createLinkManager>[0] = {}, value = MD) {
  const wiki = createWikiLinks({ search: () => [], resolve, resolveDelayMs: 5 });
  const mgr = createLinkManager({ wiki, ...extra });
  const m = keep(mount({ value, chips: wiki.chips, plugins: [wiki.plugin, mgr], links: { allowedSchemes: ["http", "https", "mailto"] } }));
  return { wiki, mgr, m };
}

describe("createLinkManager", () => {
  it("is a plugin with a command, a slash item (also in the palette) and optional toolbar item and shortcut", () => {
    const p = createLinkManager({ toolbar: true, shortcut: "Mod-Alt-l" });
    expect(p.name).toBe("link-manager");
    expect(Object.keys(p.commands!)).toEqual(["links:manage"]);
    expect(p.slash![0].label).toBe("Manage links...");
    expect(p.toolbar![0].command).toBe("links:manage");
    expect(Object.keys(p.keymap!)).toEqual(["Mod-Alt-l"]);
    const bare = createLinkManager({ slash: false });
    expect(bare.slash).toBeUndefined();
    expect(bare.toolbar).toBeUndefined();
    expect(bare.keymap).toBeUndefined();
  });

  it("lists every link with its state: ok, broken page, insecure, refused", async () => {
    const { m } = await setup();
    m.ed.exec("links:manage");
    await until(() => dialog());
    await until(() => !statuses().includes("checking"));
    expect(dialog()!.getAttribute("aria-modal")).toBe("true");
    expect(dialog()!.getAttribute("aria-labelledby")).toBeTruthy();
    const found = rowsOf().map((r) => [r.querySelector(".atm-links-text")!.textContent, r.getAttribute("data-status")]);
    expect(found).toEqual([
      ["secure", "ok"],
      ["plain", "insecure"],
      ["bad", "refused"],
      ["Alpha plan", "ok"],
      ["Gone", "broken"],
      ["logo", "insecure"],
      ["http://example.org/c", "insecure"],
      ["http://example.net/d", "insecure"],
    ]);
    expect(document.querySelector(".atm-links-summary")!.textContent).toBe("8 links, 1 broken, 4 insecure, 1 refused");
    // Status is text, not colour alone.
    expect(rowsOf()[4].querySelector(".atm-links-status")!.textContent).toBe("Broken");
  });

  it("focus moves into the dialog, Tab wraps inside it, Escape closes and returns focus", async () => {
    const { m } = await setup();
    caretAtEnd(m);
    m.surface.focus();
    const before = document.activeElement;
    m.ed.exec("links:manage");
    await until(() => dialog());
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    const f = Array.from(dialog()!.querySelectorAll<HTMLElement>("button, input")).filter((e) => !(e as HTMLButtonElement).disabled && !e.closest("[hidden]") && !(e as HTMLElement).hidden);
    f[f.length - 1].focus();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(f[0]);
    f[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(f[f.length - 1]);
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("show only problems filters the list", async () => {
    const { m } = await setup();
    m.ed.exec("links:manage");
    await until(() => dialog());
    const cb = document.querySelector<HTMLInputElement>(".atm-links-check input")!;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    expect(statuses().every((s) => s !== "ok")).toBe(true);
    expect(rowsOf().length).toBe(6);
  });

  it("remove link keeps the text, in one undo step, and announces it", async () => {
    const { m } = await setup({}, "A [one](https://example.com/1) B [two](https://example.com/2) C");
    m.ed.exec("links:manage");
    await until(() => dialog());
    btn(/^Remove link: one/).click();
    expect(m.ed.getValue()).toBe("A one B [two](https://example.com/2) C");
    expect(rowsOf().length).toBe(1);
    await until(() => /Removed the link one/.test(live() ?? ""));
    m.ed.undo();
    expect(m.ed.getValue()).toBe("A [one](https://example.com/1) B [two](https://example.com/2) C");
  });

  it("edit changes text and address, validated by the link policy; Escape cancels the edit first", async () => {
    const { m } = await setup({}, "A [one](https://example.com/1) B");
    m.ed.exec("links:manage");
    await until(() => dialog());
    btn(/^Edit: one/).click();
    const form = document.querySelector<HTMLFormElement>(".atm-links-form")!;
    const [text, href] = Array.from(form.querySelectorAll<HTMLInputElement>("input"));
    expect(text.value).toBe("one");
    expect(href.value).toBe("https://example.com/1");
    href.value = "javascript:alert(1)";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(form.querySelector(".atm-links-error")!.textContent).toMatch(/policy/);
    expect(m.ed.getValue()).toBe("A [one](https://example.com/1) B");
    text.value = "uno";
    href.value = "https://example.com/uno";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(m.ed.getValue()).toBe("A [uno](https://example.com/uno) B");
    expect(document.querySelector(".atm-links-form")).toBeNull();
    m.ed.undo();
    expect(m.ed.getValue()).toBe("A [one](https://example.com/1) B");
    await until(() => btn(/^Edit: one/));
    btn(/^Edit: one/).click();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.querySelector(".atm-links-form")).toBeNull();
    expect(dialog()).not.toBeNull(); // the first Escape only left the edit
  });

  it("upgrade to https: asks first when upgradeHosts is 'all', one undo step, links with a port or a local host stay", async () => {
    const md = "[a](http://example.com/a) [b](http://example.org/b) [c](http://localhost:3000/c) [d](http://svc.example.net:8080/d)";
    const { m } = await setup({}, md);
    m.ed.exec("links:manage");
    await until(() => dialog());
    expect(btn(/Upgrade 2 http links to https/)).toBeTruthy();
    btn(/Upgrade 2 http links to https/).click();
    expect(m.ed.getValue()).toBe(md); // nothing yet: a confirmation step
    expect(document.querySelector<HTMLElement>(".atm-links-confirm")!.hidden).toBe(false);
    btn("Upgrade").click();
    expect(m.ed.getValue()).toBe("[a](https://example.com/a) [b](https://example.org/b) [c](http://localhost:3000/c) [d](http://svc.example.net:8080/d)");
    await until(() => /Upgraded 2 links/.test(live() ?? ""));
    m.ed.undo();
    expect(m.ed.getValue()).toBe(md);
  });

  it("with a host allow-list the button only counts and rewrites those hosts, without asking", async () => {
    const md = "[a](http://one.example.com/a) [b](http://two.example.org/b)";
    const { m } = await setup({ upgradeHosts: ["*.example.com"] }, md);
    m.ed.exec("links:manage");
    await until(() => dialog());
    btn(/Upgrade 1 http link to https/).click();
    expect(m.ed.getValue()).toBe("[a](https://one.example.com/a) [b](http://two.example.org/b)");
  });

  it("check(): runs on demand, four at a time, marks failures broken, never on open", async () => {
    let running = 0;
    let peak = 0;
    const check = vi.fn(async (url: string) => {
      running++;
      peak = Math.max(peak, running);
      await wait(15);
      running--;
      return url.includes("dead") ? { ok: false, message: "404" } : true;
    });
    const md = Array.from({ length: 7 }, (_, i) => `[l${i}](https://example.com/${i === 3 ? "dead" : i})`).join(" ");
    const { m } = await setup({ check }, md);
    m.ed.exec("links:manage");
    await until(() => dialog());
    await wait(30);
    expect(check).not.toHaveBeenCalled();
    btn("Check links").click();
    await until(() => check.mock.calls.length === 7 && !btn(/Checking/));
    expect(peak).toBeLessThanOrEqual(4);
    await until(() => statuses().filter((s) => s === "broken").length === 1);
    expect(rowsOf()[3].querySelector(".atm-links-note-text")!.textContent).toBe("404");
    await until(() => /Checked 7 addresses: 1 broken/.test(live() ?? ""));
  });

  it("closing the dialog aborts checks in flight", async () => {
    let signal!: AbortSignal;
    const check = (_u: string, ctx: { signal: AbortSignal }) => ((signal = ctx.signal), new Promise<boolean>(() => {}));
    const { m, mgr } = await setup({ check }, "[a](https://example.com/a)");
    m.ed.exec("links:manage");
    await until(() => dialog());
    btn("Check links").click();
    await until(() => signal);
    mgr.close();
    expect(signal.aborted).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("Go to selects the link in the Write view and closes the dialog", async () => {
    const { m } = await setup({}, "A [one](https://example.com/1) B [two](https://example.com/2) C [two again](https://example.com/2)");
    m.ed.exec("links:manage");
    await until(() => dialog());
    btn(/^Go to: two again/).click();
    expect(dialog()).toBeNull();
    expect(document.getSelection()!.toString()).toBe("two again");
  });

  it("works in the Markdown view: edits only the changed span, go to selects the source range", async () => {
    const wiki = createWikiLinks({ search: () => [] });
    const mgr = createLinkManager({ wiki });
    const { m, ta } = await mountMd({ value: "head\n\n[one](http://example.com/1) tail", chips: wiki.chips, plugins: [wiki.plugin, mgr] });
    keep(m);
    m.ed.exec("links:manage");
    await until(() => dialog());
    btn(/Upgrade 1 http link/).click();
    btn("Upgrade").click();
    expect(ta.value).toBe("head\n\n[one](https://example.com/1) tail");
    m.ed.undo();
    expect(ta.value).toBe("head\n\n[one](http://example.com/1) tail");
    btn(/^Go to: one/).click();
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe("[one](http://example.com/1)");
  });

  it("read-only: lists and goes to links, offers no edit, remove or upgrade", async () => {
    const { m } = await setup({}, "[a](http://example.com/a)");
    m.ed.setReadOnly(true);
    m.ed.exec("links:manage");
    await until(() => dialog());
    expect(btn(/^Go to/)).toBeTruthy();
    expect(btn(/^Edit/)).toBeUndefined();
    expect(btn(/^Remove/)).toBeUndefined();
    expect(document.querySelector<HTMLElement>(".atm-links-note")!.hidden).toBe(false);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".atm-links-btn")).filter((b) => /Upgrade/.test(b.textContent ?? "") && !b.closest("[hidden]"))).toHaveLength(0);
  });

  it("an empty document says so", async () => {
    const { m } = await setup({}, "No links here.");
    m.ed.exec("links:manage");
    await until(() => dialog());
    expect(document.querySelector<HTMLElement>(".atm-links-empty")!.hidden).toBe(false);
    expect(document.querySelector(".atm-links-summary")!.textContent).toBe("0 links");
  });

  it("updates while open when the document changes", async () => {
    const { m } = await setup({}, "[a](https://example.com/a)");
    m.ed.exec("links:manage");
    await until(() => dialog());
    expect(rowsOf().length).toBe(1);
    caretAtEnd(m);
    m.ed.insertMarkdown(" [b](https://example.com/b)");
    await until(() => rowsOf().length === 2);
  });

  it("destroying the editor closes the dialog", async () => {
    const { m } = await setup();
    m.ed.exec("links:manage");
    await until(() => dialog());
    m.destroy();
    expect(dialog()).toBeNull();
    open.length = 0;
  });
});
