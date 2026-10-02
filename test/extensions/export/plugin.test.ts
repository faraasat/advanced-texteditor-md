import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExportPlugin } from "../../../src/extensions/export";
import { mount, tick, wait, selectText, type Mounted } from "../../plugins/helpers";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  vi.restoreAllMocks();
  delete (document as unknown as { execCommand?: unknown }).execCommand;
  delete (window as unknown as { ClipboardItem?: unknown }).ClipboardItem;
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

type Copied = { format: string; scope: string; ok: boolean; method: string | null };

/** Clipboard whose write() records the text/plain and text/html it was given. */
function recordClipboard() {
  const got: { plain?: string; html?: string; text?: string } = {};
  (window as unknown as { ClipboardItem: unknown }).ClipboardItem = class {
    constructor(public items: Record<string, Blob>) {}
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      write: async (items: { items: Record<string, Blob> }[]) => {
        got.plain = await items[0].items["text/plain"].text();
        got.html = await items[0].items["text/html"].text();
      },
      writeText: async (t: string) => void (got.text = t),
    },
  });
  return got;
}

function setup(value: string, o: Parameters<typeof createExportPlugin>[0] = {}, extra: Record<string, unknown> = {}) {
  m = mount({ value, plugins: [createExportPlugin(o)], ...extra });
  const events: Record<string, unknown[]> = {};
  for (const n of ["copied", "downloaded", "printed", "imported"]) m.ed.on(`plugin:export:${n}`, (p) => (events[n] ??= []).push(p));
  return events;
}
const flush = async () => {
  await tick();
  await tick();
  await wait(5);
};
const status = () => m!.ed.element.querySelector(".atm-export-live")!.textContent;

describe("copy", () => {
  it("copies the whole document as Markdown when nothing is selected", async () => {
    const ev = setup("# Hi\n\nbody **b**");
    const got = recordClipboard();
    expect(m!.ed.exec("copyMarkdown")).toBe(true);
    await flush();
    expect(got.text).toBe("# Hi\n\nbody **b**");
    expect(ev.copied[0]).toMatchObject({ format: "markdown", scope: "document", ok: true, method: "write-text" });
    await wait(60);
    expect(status()).toBe("Copied as Markdown");
  });

  it("copies the selection when there is one, and the whole document when asked", async () => {
    const ev = setup("one **two** three\n\nfour");
    const got = recordClipboard();
    m!.ed.focus();
    selectText(m!.surface, "two");
    m!.ed.exec("copyMarkdown");
    await flush();
    expect(got.text).toContain("two");
    expect(got.text).not.toContain("four");
    expect(ev.copied[0]).toMatchObject({ scope: "selection" });
    selectText(m!.surface, "two");
    m!.ed.exec("copyMarkdown", { selection: false });
    await flush();
    expect(got.text).toContain("four");
    expect(ev.copied[1]).toMatchObject({ scope: "document" });
  });

  it("copyRich carries text/plain and text/html", async () => {
    setup("# Hi\n\nbody **b**");
    const got = recordClipboard();
    m!.ed.exec("copyRich");
    await flush();
    expect(got.html).toContain("<strong");
    expect(got.html).toContain("<h1");
    expect(got.plain).toContain("body b");
    expect(got.plain).not.toContain("**");
  });

  it("copyHtml copies the source as text; standalone is a whole document", async () => {
    setup("# Hi");
    const got = recordClipboard();
    m!.ed.exec("copyHtml");
    await flush();
    expect(got.text).toBe('<h1 class="atm-h1">Hi</h1>');
    m!.ed.exec("copyHtml", { standalone: true });
    await flush();
    expect(got.text!.startsWith("<!doctype html>")).toBe(true);
  });

  it("copyText copies plain text", async () => {
    setup("# Hi\n\nbody **b**");
    const got = recordClipboard();
    m!.ed.exec("copyText");
    await flush();
    expect(got.text).toContain("body b");
  });

  it("uses a copy event when the clipboard API is refused, and says so", async () => {
    const ev = setup("hello **x**");
    (window as unknown as { ClipboardItem: unknown }).ClipboardItem = class {};
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: () => Promise.reject(new Error("denied")) } });
    const data: Record<string, string> = {};
    (document as unknown as { execCommand: unknown }).execCommand = () => {
      const e = new Event("copy", { cancelable: true }) as Event & { clipboardData: unknown };
      e.clipboardData = { setData: (t: string, v: string) => (data[t] = v) };
      document.dispatchEvent(e);
      return true;
    };
    m!.ed.exec("copyRich");
    await flush();
    expect(data["text/html"]).toContain("<strong");
    expect(data["text/plain"]).toContain("hello x");
    expect((ev.copied[0] as Copied).method).toBe("copy-event");
  });

  it("reports failure through the event and the status", async () => {
    const ev = setup("hello");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    (document as unknown as { execCommand: unknown }).execCommand = () => false;
    m!.ed.exec("copyMarkdown");
    await flush();
    expect(ev.copied[0]).toMatchObject({ ok: false, method: null });
    await wait(60);
    expect(status()).toBe("Could not copy to the clipboard");
  });

  it("refuses an empty document", async () => {
    const ev = setup("");
    expect(m!.ed.exec("copyMarkdown")).toBe(false);
    expect(ev.copied).toBeUndefined();
  });

  it("works in a read-only editor", async () => {
    setup("# ro", {}, { readOnly: true });
    const got = recordClipboard();
    expect(m!.ed.exec("copyMarkdown")).toBe(true);
    await flush();
    expect(got.text).toBe("# ro");
  });

  it("labels and onStatus", async () => {
    const seen: string[] = [];
    setup("x", { labels: { copied: "Kopiert: {what}", whatMarkdown: "MD" }, onStatus: (s) => seen.push(s) });
    recordClipboard();
    m!.ed.exec("copyMarkdown");
    await flush();
    expect(seen).toEqual(["Kopiert: MD"]);
  });
});

describe("download", () => {
  let urls: Blob[];
  let clicks: { download: string; href: string }[];
  beforeEach(() => {
    urls = [];
    clicks = [];
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = (b: Blob) => (urls.push(b), "blob:test/" + urls.length);
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href });
    });
  });

  it("downloads Markdown named after the first heading, and revokes the URL", async () => {
    const ev = setup("# My Doc!\n\nx");
    expect(m!.ed.exec("downloadMarkdown")).toBe(true);
    expect(clicks).toEqual([{ download: "my-doc.md", href: "blob:test/1" }]);
    expect(urls[0].type).toBe("text/markdown;charset=utf-8");
    expect(await urls[0].text()).toBe("# My Doc!\n\nx");
    expect(document.querySelector("a[download]")).toBeNull();
    await wait(1100);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test/1");
    expect(ev.downloaded[0]).toMatchObject({ format: "markdown", filename: "my-doc.md" });
  });

  it("sanitises the name from the argument or the option", () => {
    setup("# T", { filename: "../../evil‮.exe" });
    m!.ed.exec("downloadMarkdown");
    m!.ed.exec("downloadMarkdown", "a/b:c");
    m!.ed.exec("downloadMarkdown", { filename: "CON" });
    expect(clicks.map((c) => c.download)).toEqual(["evil.exe.md", "a-b-c.md", "_CON.md"]);
  });

  it("accepts a function for the name, and falls back to document", () => {
    setup("no heading", { filename: (ed) => "n-" + ed.getValue().length });
    m!.ed.exec("downloadMarkdown");
    expect(clicks[0].download).toBe("n-10.md");
    m!.destroy();
    setup("no heading");
    m!.ed.exec("downloadMarkdown");
    expect(clicks[1].download).toBe("document.md");
  });

  it("downloads a standalone HTML document", async () => {
    setup("# Title\n\n<script>window.__xss=1</script>");
    m!.ed.exec("downloadHtml");
    expect(clicks[0].download).toBe("title.html");
    expect(urls[0].type).toBe("text/html;charset=utf-8");
    const doc = new DOMParser().parseFromString(await urls[0].text(), "text/html");
    expect(doc.title).toBe("Title");
    expect(doc.querySelector("script")).toBeNull();
  });
});

describe("print", () => {
  it("prints a standalone copy through a hidden iframe and removes it", async () => {
    const printed: string[] = [];
    const ev = setup("# Print me", { print: (w) => printed.push(w.document.documentElement.outerHTML) });
    expect(m!.ed.exec("print")).toBe(true);
    const frame = () => document.querySelector<HTMLIFrameElement>("iframe.atm-print-frame");
    expect(frame()).not.toBeNull();
    expect(frame()!.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
    expect(frame()!.getAttribute("aria-hidden")).toBe("true");
    // jsdom does not load srcdoc documents, so the print call itself is covered by the e2e spec.
    expect(frame()!.getAttribute("srcdoc")).toContain("Print me");
    expect(frame()!.getAttribute("srcdoc")).toContain("Content-Security-Policy");
    expect(frame()!.getAttribute("srcdoc")).toContain("--atm-bg:#ffffff");
    void printed;
    expect(ev.printed[0]).toMatchObject({ mode: "iframe" });
  });

  it("window mode marks the page and cleans up", async () => {
    const calls: boolean[] = [];
    setup("# P", { printMode: "window", print: () => calls.push(document.documentElement.classList.contains("atm-printing") && m!.ed.element.classList.contains("atm-print-root")) });
    m!.ed.exec("print");
    expect(calls).toEqual([true]);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.documentElement.classList.contains("atm-printing")).toBe(false);
    expect(m!.ed.element.classList.contains("atm-print-root")).toBe(false);
  });

  it("refuses an empty document", () => {
    setup("");
    expect(m!.ed.exec("print")).toBe(false);
  });
});

const file = (content: string, name: string, type = "") => new File([content], name, { type });
const dropEvent = (files: File[]) => {
  const e = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
  e.dataTransfer = { files, types: ["Files"] };
  return e;
};

describe("import by command", () => {
  it("replaces an empty document at once", async () => {
    const ev = setup("");
    m!.ed.exec("importFile", file("# Loaded\n\n**yes**", "a.md"));
    await flush();
    expect(m!.ed.getValue().trim()).toBe("# Loaded\n\n**yes**");
    expect(ev.imported[0]).toMatchObject({ ok: true, kind: "markdown", mode: "replace", source: "picker" });
  });

  it("imports text escaped and HTML converted", async () => {
    setup("");
    m!.ed.exec("importFile", file("# plain *text*", "a.txt"));
    await flush();
    expect(m!.ed.getAst().children[0].type).toBe("paragraph");
    expect(m!.ed.getText()).toContain("# plain *text*");
    m!.ed.setValue("");
    m!.ed.exec("importFile", file("<h2>Hello</h2><p><b>x</b></p><script>window.__xss=1</script>", "a.html"));
    await flush();
    expect(m!.ed.getValue()).toContain("## Hello");
    expect(m!.ed.getValue()).toContain("**x**");
    expect(m!.ed.getValue()).not.toContain("script");
  });

  it("reports why a file was refused and changes nothing", async () => {
    const ev = setup("keep");
    m!.ed.exec("importFile", file("x", "a.docx"));
    m!.ed.exec("importFile", file("a\u0000b", "bin.md"));
    await flush();
    expect(m!.ed.getValue()).toBe("keep");
    expect(ev.imported.map((e) => (e as { reason: string }).reason)).toEqual(["unsupported", "binary"]);
    await wait(60);
    expect(status()).toContain("does not look like a text file");
  });

  it("insert mode inserts, replace mode replaces in ONE undo step", async () => {
    setup("old text", { importMode: "insert" });
    m!.ed.focus();
    m!.ed.exec("importFile", file("NEW", "a.md"));
    await flush();
    expect(m!.ed.getValue()).toContain("old text");
    expect(m!.ed.getValue()).toContain("NEW");
    m!.destroy();

    const ev = setup("# old\n\ntext\n\n- a\n- b", { importMode: "replace" });
    m!.ed.exec("importFile", file("# fresh\n\npara", "a.md"));
    await flush();
    expect(m!.ed.getValue().trim()).toBe("# fresh\n\npara");
    expect(ev.imported[0]).toMatchObject({ ok: true, mode: "replace" });
    expect(m!.ed.undo()).toBe(true);
    expect(m!.ed.getValue().trim()).toBe("# old\n\ntext\n\n- a\n- b");
  });

  it("does nothing in a read-only editor", async () => {
    setup("ro", {}, { readOnly: true });
    expect(m!.ed.exec("importFile", file("x", "a.md"))).toBe(false);
    expect(m!.ed.getValue()).toBe("ro");
  });

  it("opens the picker with the right accept list", () => {
    setup("x");
    const input = m!.ed.element.querySelector<HTMLInputElement>("input[type=file][data-atm-export-file]")!;
    expect(input.accept).toContain(".md");
    expect(input.accept).toContain(".html");
    expect(input.accept).not.toContain("docx");
    const click = vi.spyOn(input, "click");
    expect(m!.ed.exec("importFile")).toBe(true);
    expect(click).toHaveBeenCalled();
  });

  it("picking a file through the input imports it", async () => {
    setup("");
    const input = m!.ed.element.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { configurable: true, value: [file("# picked", "p.md")] });
    input.dispatchEvent(new Event("change"));
    await flush();
    expect(m!.ed.getValue().trim()).toBe("# picked");
  });
});

describe("drop", () => {
  const dropOnSurface = (files: File[]) => {
    const e = dropEvent(files);
    let reached = false;
    m!.surface.addEventListener("drop", () => (reached = true), { once: true });
    m!.surface.dispatchEvent(e);
    return { e, reached: () => reached };
  };

  it("loads a .md file at once when the editor is empty, and the editor never sees the drop", async () => {
    const ev = setup("");
    const { e, reached } = dropOnSurface([file("# Dropped", "d.md", "text/markdown")]);
    expect(e.defaultPrevented).toBe(true);
    expect(reached()).toBe(false);
    await flush();
    expect(m!.ed.getValue().trim()).toBe("# Dropped");
    expect(ev.imported[0]).toMatchObject({ ok: true, source: "drop" });
  });

  it("recognises .markdown, .txt and a text/markdown MIME without an extension", async () => {
    for (const f of [file("# a", "a.markdown"), file("b", "b.txt", "text/plain"), file("# c", "readme", "text/markdown")]) {
      setup("");
      dropOnSurface([f]);
      await flush();
      expect(m!.ed.getValue().trim().length).toBeGreaterThan(0);
      m!.destroy();
    }
  });

  it("lets every other file through to the editor's upload path untouched", async () => {
    setup("");
    for (const files of [[file("x", "a.png", "image/png")], [file("a", "a.md"), file("b", "b.md")], [file("x", "a.html", "text/html")], [file("x", "a.pdf", "application/pdf")]]) {
      const { e, reached } = dropOnSurface(files);
      // The editor's own drop handler may cancel the browser default: what matters is that it was reached.
      expect(reached()).toBe(true);
      void e;
    }
    expect(m!.ed.getValue()).toBe("");
  });

  it("with content: asks through the bar, Replace replaces", async () => {
    setup("# keep me");
    m!.ed.focus();
    const before = document.activeElement;
    dropOnSurface([file("# New", "n.md")]);
    await flush();
    const bar = m!.ed.element.querySelector<HTMLElement>(".atm-export-confirm")!;
    expect(bar.getAttribute("role")).toBe("alertdialog");
    expect(bar.getAttribute("aria-labelledby")).toBeTruthy();
    expect(bar.textContent).toContain("n.md");
    expect(m!.ed.getValue()).toBe("# keep me");
    expect(bar.contains(document.activeElement)).toBe(true);
    bar.querySelector<HTMLButtonElement>(".atm-export-replace")!.click();
    await flush();
    expect(m!.ed.element.querySelector(".atm-export-confirm")).toBeNull();
    expect(m!.ed.getValue().trim()).toBe("# New");
    expect(document.activeElement === before || m!.ed.element.contains(document.activeElement)).toBe(true);
  });

  it("Insert keeps the old content", async () => {
    setup("# keep me");
    dropOnSurface([file("added", "n.md")]);
    await flush();
    m!.ed.element.querySelector<HTMLButtonElement>(".atm-export-insert")!.click();
    await flush();
    expect(m!.ed.getValue()).toContain("keep me");
    expect(m!.ed.getValue()).toContain("added");
  });

  it("Cancel and Escape change nothing and give the focus back", async () => {
    const ev = setup("# keep me");
    m!.ed.focus();
    dropOnSurface([file("# New", "n.md")]);
    await flush();
    m!.ed.element.querySelector<HTMLButtonElement>(".atm-export-cancel")!.click();
    await flush();
    expect(m!.ed.getValue()).toBe("# keep me");
    expect(m!.ed.element.querySelector(".atm-export-confirm")).toBeNull();

    dropOnSurface([file("# New", "n.md")]);
    await flush();
    const bar = m!.ed.element.querySelector<HTMLElement>(".atm-export-confirm")!;
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();
    expect(m!.ed.getValue()).toBe("# keep me");
    expect(m!.ed.element.querySelector(".atm-export-confirm")).toBeNull();
    expect(ev.imported.every((x) => (x as { reason?: string }).reason === "cancelled")).toBe(true);
  });

  it("Tab cycles inside the bar", async () => {
    setup("# keep me");
    dropOnSurface([file("# New", "n.md")]);
    await flush();
    const bar = m!.ed.element.querySelector<HTMLElement>(".atm-export-confirm")!;
    const names = Array.from(bar.querySelectorAll("button")).map((b) => b.className);
    expect(names.length).toBe(3);
    const seen: Element[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(document.activeElement!);
      bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    }
    expect(new Set(seen).size).toBe(3);
    expect(document.activeElement).toBe(seen[0]);
  });

  it("a hostile file name is shown as text", async () => {
    setup("# keep");
    dropOnSurface([file("x", '<img src=x onerror="window.__xss=1">‮.md')]);
    await flush();
    const bar = m!.ed.element.querySelector<HTMLElement>(".atm-export-confirm")!;
    expect(bar.querySelector("img")).toBeNull();
    expect(bar.textContent).toContain("<img src=x");
    expect(bar.textContent).not.toContain("‮");
    expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
  });

  it("confirmReplace is used instead of the bar (sync, async, refusing)", async () => {
    const asked: string[] = [];
    setup("# keep", { confirmReplace: async (f) => (asked.push(f.name), f.name === "yes.md") });
    dropOnSurface([file("# no", "no.md")]);
    await flush();
    expect(m!.ed.getValue()).toBe("# keep");
    expect(m!.ed.element.querySelector(".atm-export-confirm")).toBeNull();
    dropOnSurface([file("# yes", "yes.md")]);
    await flush();
    expect(m!.ed.getValue().trim()).toBe("# yes");
    expect(asked).toEqual(["no.md", "yes.md"]);
  });

  it("a throwing confirmReplace cancels", async () => {
    setup("# keep", { confirmReplace: () => Promise.reject(new Error("x")) });
    dropOnSurface([file("# no", "no.md")]);
    await flush();
    expect(m!.ed.getValue()).toBe("# keep");
  });

  it("drop: false and read-only leave the drop alone", async () => {
    setup("", { drop: false });
    expect(dropOnSurface([file("# a", "a.md")]).reached()).toBe(true);
    await flush();
    expect(m!.ed.getValue()).toBe("");
    m!.destroy();
    setup("", {}, { readOnly: true });
    expect(dropOnSurface([file("# a", "a.md")]).reached()).toBe(true);
    await flush();
    expect(m!.ed.getValue()).toBe("");
  });
});

describe("the plugin's UI is not content", () => {
  it("never reaches the Markdown, in the surface or after an edit", async () => {
    setup("# A\n\ntext");
    const before = m!.ed.getValue();
    dropOnSurface2();
    await flush();
    expect(m!.ed.getValue()).toBe(before);
    expect(m!.surface.querySelector(".atm-export-confirm, .atm-export-live, input[type=file]")).toBeNull();
    m!.ed.insertText("more");
    expect(m!.ed.getValue()).not.toMatch(/atm-export|alertdialog|Replace|Cancel/);
    function dropOnSurface2() {
      m!.surface.dispatchEvent(dropEvent([file("# N", "n.md")]));
    }
  });

  it("an IME composition triggers nothing", async () => {
    const ev = setup("# A");
    const spy = vi.fn();
    m!.ed.on("plugin:export:copied", spy);
    m!.surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    m!.surface.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertCompositionText", data: "に", bubbles: true, cancelable: true }));
    m!.surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", isComposing: true, bubbles: true, cancelable: true }));
    m!.surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "に" }));
    await flush();
    expect(spy).not.toHaveBeenCalled();
    expect(Object.keys(ev)).toEqual([]);
    expect(m!.ed.element.querySelector(".atm-export-confirm")).toBeNull();
    expect(status()).toBe("");
  });

  it("cleans up on destroy", () => {
    setup("x");
    const el = m!.ed.element;
    m!.destroy();
    expect(el.querySelector(".atm-export-live, input[data-atm-export-file], .atm-export-confirm")).toBeNull();
    m = null;
  });
});

describe("toolbar and slash items", () => {
  it("exposes an Export menu button and the slash items", () => {
    const p = createExportPlugin();
    expect(p.name).toBe("export");
    expect(p.toolbar?.[0].id).toBe("export");
    expect(Object.keys(p.commands!).sort()).toEqual(["copyHtml", "copyMarkdown", "copyRich", "copyText", "downloadHtml", "downloadMarkdown", "importFile", "print"]);
    expect(p.slash?.length).toBe(8);
    expect(createExportPlugin({ toolbar: false, slash: false })).toMatchObject({ toolbar: [], slash: [] });
  });

  it("the menu is a keyboard-operable menu button", async () => {
    setup("# A");
    const item = createExportPlugin().toolbar![0];
    const el = item.render!(m!.ed);
    document.body.append(el);
    const button = el.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]")!;
    const menu = el.querySelector<HTMLElement>("[role=menu]")!;
    expect(menu.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
    expect(items.length).toBe(8);
    expect(document.activeElement).toBe(items[0]);
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[7]);
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    el.remove();
  });

  it("disables entries that cannot work", () => {
    setup("", {}, { readOnly: true });
    const item = createExportPlugin().toolbar![0];
    expect(item.isEnabled!(m!.ed)).toBe(false);
    const el = item.render!(m!.ed);
    document.body.append(el);
    el.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]")!.click();
    expect(Array.from(el.querySelectorAll<HTMLButtonElement>("[role=menuitem]")).every((b) => b.disabled)).toBe(true);
    el.remove();
  });
});
