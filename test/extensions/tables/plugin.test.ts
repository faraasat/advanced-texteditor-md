import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, renderHtml } from "../../../src/render";
import { hydrateAll } from "../../../src/plugins/hydrate";
import { createTablesPlugin, inFence, TABLE_KEYS } from "../../../src/extensions/tables";
import { caretAfter, mount, pressKey, textareaReady, tick, wait, type Mounted } from "../../plugins/helpers";

const T = "| A | B | C |\n| :--- | --- | ---: |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n| a3 | b3 | c3 |";
const DOC = `Intro\n\n${T}\n\nAfter`;

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
});

const open = (opts: Parameters<typeof createTablesPlugin>[0] = {}, value = DOC, extra = {}) => {
  m = mount({ value, plugins: [createTablesPlugin(opts)], ...extra });
  return m;
};
const caretText = () => {
  const s = document.getSelection()!;
  return (s.anchorNode?.nodeType === 3 ? s.anchorNode.parentElement : (s.anchorNode as Element))?.closest("td,th")?.textContent;
};
const mac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const modKeys = (o: Record<string, boolean> = {}) => (mac() ? { meta: true, ...o } : { ctrl: true, ...o });

describe("move rows and columns (WYSIWYG)", () => {
  it("moves a row down as one undo step, the caret stays in the moved cell", async () => {
    open();
    caretAfter(m!.surface, "b1");
    expect(m!.ed.exec("tableMoveRowDown")).toBe(true);
    expect(m!.ed.getValue()).toContain("| a2 | b2 | c2 |\n| a1 | b1 | c1 |");
    expect(caretText()).toBe("b1");
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe(DOC);
  });
  it("moves a column with its alignment", () => {
    open();
    caretAfter(m!.surface, "a2");
    expect(m!.ed.exec("tableMoveColumnRight")).toBe(true);
    expect(m!.ed.getValue()).toContain("| B | A | C |\n| --- | :--- | ---: |\n| b1 | a1 | c1 |");
    expect(caretText()).toBe("a2");
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe(DOC);
  });
  it("the header row cannot move, nor can a row move into it", () => {
    open();
    caretAfter(m!.surface, "B");
    expect(m!.ed.exec("tableMoveRowDown")).toBe(false);
    caretAfter(m!.surface, "b1");
    expect(m!.ed.exec("tableMoveRowUp")).toBe(false);
    caretAfter(m!.surface, "c3");
    expect(m!.ed.exec("tableMoveRowDown")).toBe(false);
    expect(m!.ed.exec("tableMoveColumnRight")).toBe(false);
    expect(m!.ed.getValue()).toBe(DOC);
  });
  it("outside a table every command is a no-op", () => {
    open();
    caretAfter(m!.surface, "Intro");
    for (const c of ["tableMoveRowUp", "tableMoveRowDown", "tableMoveColumnLeft", "tableMoveColumnRight", "tableToggleHeader"]) expect(m!.ed.exec(c)).toBe(false);
    expect(m!.ed.getValue()).toBe(DOC);
  });
  it("read-only: nothing runs", () => {
    open({}, DOC, { readOnly: true });
    caretAfter(m!.surface, "b1");
    expect(m!.ed.exec("tableMoveRowDown")).toBe(false);
    expect(m!.ed.exec("tableImport", "a,b\n1,2")).toBe(false);
  });
  it("the shortcut moves the row; a composition does not", async () => {
    open();
    caretAfter(m!.surface, "b2");
    const ev = new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", altKey: true, shiftKey: true, ...(mac() ? { metaKey: true } : { ctrlKey: true }), isComposing: true, cancelable: true, bubbles: true });
    m!.surface.dispatchEvent(ev);
    expect(m!.ed.getValue()).toBe(DOC);
    m!.surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(m!.ed.exec("tableMoveRowUp")).toBe(false);
    m!.surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    pressKey(m!.surface, "ArrowUp", modKeys({ alt: true, shift: true }), "ArrowUp");
    expect(m!.ed.getValue()).toContain("| a2 | b2 | c2 |\n| a1 | b1 | c1 |");
  });
});

describe("header toggle", () => {
  it("off empties the header row and keeps the old header as the first body row; on restores it", () => {
    open();
    caretAfter(m!.surface, "B");
    expect(m!.ed.exec("tableToggleHeader")).toBe(true);
    expect(m!.ed.getValue()).toContain("|  |  |  |\n| :--- | --- | ---: |\n| A | B | C |\n| a1 | b1 | c1 |");
    expect(caretText()).toBe("B");
    expect(m!.ed.exec("tableToggleHeader")).toBe(true);
    expect(m!.ed.getValue()).toBe(DOC);
    m!.ed.undo();
    expect(m!.ed.getValue()).toContain("|  |  |  |");
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe(DOC);
  });
  it("a headless table is marked for CSS in the editor and in a view", async () => {
    const md = "|  |  |\n| --- | --- |\n| x | y |";
    open({}, md);
    await wait(40);
    expect(m!.surface.querySelector("table")!.getAttribute("data-atm-tables-headless")).toBe("editor");
    const p = createTablesPlugin();
    const frag = renderDom(md, { postRender: [p.postRender!] });
    const holder = document.createElement("div");
    holder.appendChild(frag);
    expect(holder.querySelector("table")!.getAttribute("data-atm-tables-headless")).toBe("view");
  });
});

describe("alignment shortcuts", () => {
  it("Mod-Alt-Shift-E centres the caret's column; again clears it", () => {
    open();
    caretAfter(m!.surface, "b2");
    pressKey(m!.surface, "E", modKeys({ alt: true, shift: true }), "KeyE");
    expect(m!.ed.getValue()).toContain("| :--- | :---: | ---: |");
    pressKey(m!.surface, "E", modKeys({ alt: true, shift: true }), "KeyE");
    expect(m!.ed.getValue()).toBe(DOC);
  });
  it("keys can be remapped or switched off", () => {
    const p = createTablesPlugin({ keys: { alignLeft: false, moveRowUp: "Alt-Shift-u" } });
    expect(Object.keys(p.keymap!)).not.toContain(TABLE_KEYS.alignLeft);
    expect(p.keymap!["Alt-Shift-u"]).toBe("tableMoveRowUp");
  });
});

describe("Markdown mode", () => {
  it("moves, toggles and aligns the table around the caret in the textarea, one undo step each", async () => {
    open({}, DOC, { mode: "markdown" });
    const ta = await textareaReady(m!);
    const at = DOC.indexOf("b2");
    ta.focus();
    ta.setSelectionRange(at, at);
    expect(m!.ed.exec("tableMoveRowUp")).toBe(true);
    expect(m!.ed.getValue()).toContain("| a2 | b2 | c2 |\n| a1 | b1 | c1 |");
    expect(ta.value.slice(ta.selectionStart, ta.selectionStart + 2)).toBe("b2");
    expect(m!.ed.exec("tableMoveColumnLeft")).toBe(true);
    expect(m!.ed.getValue()).toContain("| B | A | C |\n| --- | :--- | ---: |");
    expect(ta.value.slice(ta.selectionStart, ta.selectionStart + 2)).toBe("b2");
    m!.ed.undo();
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe(DOC);
    ta.setSelectionRange(DOC.indexOf("B |"), DOC.indexOf("B |"));
    expect(m!.ed.exec("tableToggleHeader")).toBe(true);
    expect(m!.ed.getValue()).toContain("|  |  |  |\n| :--- | --- | ---: |\n| A | B | C |");
    m!.ed.undo();
    ta.setSelectionRange(DOC.indexOf("c1"), DOC.indexOf("c1"));
    const kd = pressKey(ta, "L", modKeys({ alt: true, shift: true }), "KeyL");
    expect(kd.defaultPrevented).toBe(true);
    expect(m!.ed.getValue()).toContain("| :--- | --- | :--- |");
  });
  it("outside a table it returns false", async () => {
    open({}, DOC, { mode: "markdown" });
    const ta = await textareaReady(m!);
    ta.setSelectionRange(1, 1);
    expect(m!.ed.exec("tableMoveRowUp")).toBe(false);
  });
  it("import inserts the table as its own block", async () => {
    open({}, "Para", { mode: "markdown" });
    const ta = await textareaReady(m!);
    ta.setSelectionRange(4, 4);
    expect(m!.ed.exec("tableImport", "x,y\n1,2")).toBe(true);
    expect(m!.ed.getValue()).toBe("Para\n\n| x | y |\n| --- | --- |\n| 1 | 2 |\n");
  });
  it("inFence", () => {
    const s = "a\n```\n| x |\n```\nb";
    expect(inFence(s, s.indexOf("x"))).toBe(true);
    expect(inFence(s, s.length - 1)).toBe(false);
  });
});

/** A paste event with clipboard data (jsdom has no DataTransfer). */
function paste(target: HTMLElement, data: Record<string, string>): ClipboardEvent {
  const ev = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => data[k] ?? "", files: [], items: [], types: Object.keys(data) } });
  target.dispatchEvent(ev);
  return ev;
}

describe("spreadsheet paste", () => {
  it("TSV in text/plain becomes a table, one undo step", async () => {
    open({}, "Start");
    caretAfter(m!.surface, "Start");
    const ev = paste(m!.surface, { "text/plain": "Name\tQty\nApples\t3\nPears\t\n" });
    expect(ev.defaultPrevented).toBe(true);
    await tick();
    expect(m!.ed.getValue()).toBe("Start\n\n| Name | Qty |\n| --- | --- |\n| Apples | 3 |\n| Pears |  |");
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe("Start");
  });
  it("one line is a table only when the HTML has one", async () => {
    open({}, "s");
    caretAfter(m!.surface, "s");
    paste(m!.surface, { "text/plain": "a\tb" });
    await tick();
    expect(m!.ed.getValue()).not.toContain("|");
    paste(m!.surface, { "text/plain": "a\tb", "text/html": "<table><tr><td>a</td><td>b</td></tr></table>" });
    await tick();
    expect(m!.ed.getValue()).toContain("| a | b |\n| --- | --- |");
  });
  it("spreadsheet HTML without TSV text is cleaned: br in cells, colgroup, empty trailing rows", async () => {
    open({}, "x");
    caretAfter(m!.surface, "x");
    const html = '<google-sheets-html-origin><table><colgroup><col width="100"></colgroup><tr><td style="color:red">a<br>b</td></tr><tr><td>c</td></tr><tr><td></td></tr></table>';
    paste(m!.surface, { "text/plain": "a b\nc\n", "text/html": html });
    await tick();
    expect(m!.ed.getValue()).toBe("x\n\n| a b |\n| --- |\n| c |");
  });
  it("rich HTML that is not a table is left to the editor", () => {
    open({}, "x");
    caretAfter(m!.surface, "x");
    const handled: boolean[] = [];
    m!.ed.element.addEventListener("paste", (e) => handled.push(e.defaultPrevented));
    paste(m!.surface, { "text/plain": "a\tb\nc\td", "text/html": "<p>a b</p>" });
    expect(handled).toEqual([true]); // the surface cancelled it with its own handling
    expect(m!.ed.getValue()).not.toContain("| a | b |");
  });
  it("inside a code block it is never a table", async () => {
    open({}, "```\ncode\n```");
    caretAfter(m!.surface, "code");
    paste(m!.surface, { "text/plain": "a\tb\nc\td" });
    await tick();
    expect(m!.ed.getValue()).not.toContain("| a |");
  });
  it("inside a cell the values fill consecutive cells, adding rows and columns", async () => {
    open({}, "| A | B |\n| --- | --- |\n| 1 | 2 |");
    caretAfter(m!.surface, "2");
    paste(m!.surface, { "text/plain": "x\ty\nz\tw" });
    await tick();
    expect(m!.ed.getValue()).toBe("| A | B |  |\n| --- | --- | --- |\n| 1 | x | y |\n|  | z | w |");
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });
  it("caps the columns and rows", async () => {
    open({ limits: { maxColumns: 2, maxRows: 1 } }, "s");
    caretAfter(m!.surface, "s");
    const seen: unknown[] = [];
    m!.ed.on("plugin:tables:paste", (p) => seen.push(p));
    paste(m!.surface, { "text/plain": "a\tb\tc\n1\t2\t3\n4\t5\t6" });
    await tick();
    expect(m!.ed.getValue()).toBe("s\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(seen).toEqual([{ rows: 1, columns: 2, truncated: true }]);
  });
  it("paste: false switches it off", () => {
    open({ paste: false }, "s");
    caretAfter(m!.surface, "s");
    paste(m!.surface, { "text/plain": "a\tb\nc\td" });
    expect(m!.ed.getValue()).not.toContain("| a | b |");
  });
});

describe("CSV import", () => {
  it("a string argument inserts a table at the caret, one undo step", () => {
    open({}, "Para");
    caretAfter(m!.surface, "Para");
    expect(m!.ed.exec("tableImport", "name;age\nAda;36")).toBe(true);
    expect(m!.ed.getValue()).toBe("Para\n\n| name | age |\n| --- | --- |\n| Ada | 36 |");
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe("Para");
  });
  it("in a table cell the new table goes after the table", () => {
    open({}, "| A |\n| --- |\n| 1 |");
    caretAfter(m!.surface, "1");
    m!.ed.exec("tableImport", "x\n2");
    expect(m!.ed.getValue()).toBe("| A |\n| --- |\n| 1 |\n\n| x |\n| --- |\n| 2 |");
  });
  it("refuses over a limit, visibly, and tells the host", () => {
    const onImportError = vi.fn();
    open({ limits: { maxRows: 1 }, onImportError }, "P");
    caretAfter(m!.surface, "P");
    const ev = vi.fn();
    m!.ed.on("plugin:tables:import-rejected", ev);
    expect(m!.ed.exec("tableImport", "h\n1\n2")).toBe(false);
    expect(m!.ed.getValue()).toBe("P");
    expect(onImportError.mock.calls[0][0].reason).toBe("too-many-rows");
    expect(ev.mock.calls[0][0]).toMatchObject({ reason: "too-many-rows" });
    const notice = m!.ed.element.querySelector<HTMLElement>(".atm-tables-notice")!;
    expect(notice.hidden).toBe(false);
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain("more than 1 rows");
  });
  it("a file larger than the limit is refused without reading it", async () => {
    open({ limits: { maxBytes: 5 } }, "P");
    const file = new File(["a,b,c,d,e,f"], "x.csv", { type: "text/csv" });
    const text = vi.spyOn(file, "text");
    m!.ed.exec("tableImport", file);
    expect(text).not.toHaveBeenCalled();
    expect(m!.ed.element.querySelector(".atm-tables-notice")!.textContent).toContain("larger than 5 B");
  });
  it("no argument opens a file picker for CSV / TSV", () => {
    open({}, "P");
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    m!.ed.exec("tableImport");
    const input = m!.ed.element.querySelector<HTMLInputElement>("input.atm-tables-file")!;
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".csv,.tsv,text/csv,text/tab-separated-values");
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});

describe("the chrome picks the plugin up", () => {
  it("toolbar, slash and keymap entries", () => {
    const p = createTablesPlugin();
    expect(p.toolbar!.map((t) => t.id)).toEqual(["tableImport", "tableToggleHeader", "tableMoveRowUp", "tableMoveRowDown", "tableMoveColumnLeft", "tableMoveColumnRight"]);
    expect(p.slash!.map((s) => s.label)).toContain("Import CSV");
    expect(Object.keys(p.keymap!)).toEqual(expect.arrayContaining(Object.values(TABLE_KEYS)));
    expect(createTablesPlugin({ toolbar: false, slash: false }).toolbar).toEqual([]);
  });
  it("toolbar items are enabled only in a table", () => {
    open();
    const p = (m!.ed.options.plugins![0] as ReturnType<typeof createTablesPlugin>).toolbar!;
    const up = p.find((t) => t.id === "tableMoveRowUp")!;
    caretAfter(m!.surface, "Intro");
    expect(up.isEnabled!(m!.ed)).toBe(false);
    caretAfter(m!.surface, "b2");
    expect(up.isEnabled!(m!.ed)).toBe(true);
    const hd = p.find((t) => t.id === "tableToggleHeader")!;
    expect(hd.isActive!(m!.ed)).toBe(true);
  });
  it("labels override every string", () => {
    const p = createTablesPlugin({ labels: { importCsv: "CSV importieren" } });
    expect(p.toolbar![0].label).toBe("CSV importieren");
  });
});

describe("column widths are view-only", () => {
  it("resizing by keyboard draws a colgroup the Markdown never sees, and survives edits", async () => {
    open();
    m!.surface.focus();
    caretAfter(m!.surface, "b1");
    await wait(40);
    expect(m!.ed.exec("tableFocusResize")).toBe(true);
    const sep = document.activeElement as HTMLElement;
    expect(sep.getAttribute("role")).toBe("separator");
    expect(sep.getAttribute("aria-orientation")).toBe("vertical");
    expect(sep.getAttribute("aria-label")).toBe("Resize column 2");
    expect(m!.surface.contains(sep)).toBe(false);
    sep.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    const col = m!.surface.querySelectorAll("table colgroup col")[1] as HTMLElement;
    expect(col.style.width).toMatch(/px$/);
    expect(Number(sep.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    expect(m!.ed.getValue()).toBe(DOC);
    // An edit elsewhere: still nothing of the decoration in the Markdown.
    caretAfter(m!.surface, "c3");
    m!.ed.exec("tableMoveRowUp");
    expect(m!.ed.getValue()).not.toMatch(/col|width|px/);
    expect(m!.surface.querySelector("colgroup")!.hasAttribute("data-atm-preview-card")).toBe(true);
    sep.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    await wait(30);
    expect(m!.surface.querySelector("colgroup")).toBeNull();
  });
  it("Escape on a handle returns to the editor", async () => {
    open();
    m!.surface.focus();
    caretAfter(m!.surface, "b1");
    await wait(30);
    m!.ed.exec("tableFocusResize");
    const sep = document.activeElement as HTMLElement;
    sep.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(m!.ed.element.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(sep);
  });
  it("resizable: false draws no handles", async () => {
    open({ resizable: false, grips: false });
    await wait(30);
    expect(m!.ed.element.querySelector(".atm-tables-layer")).toBeNull();
    expect(m!.ed.exec("tableFocusResize")).toBe(false);
  });
});

describe("sortable read-only views", () => {
  const view = (opts = {}) => {
    const p = createTablesPlugin({ sortable: true, ...opts });
    const host = document.createElement("div");
    host.appendChild(renderDom(T, { postRender: [p.postRender!] }));
    document.body.appendChild(host);
    return host;
  };
  const col0 = (host: HTMLElement) => Array.from(host.querySelectorAll("tbody tr")).map((r) => r.children[0].textContent);
  it("header cells become sort buttons with aria-sort; ascending, descending, original", async () => {
    const host = view();
    const btn = host.querySelectorAll<HTMLButtonElement>("th button.atm-tables-sort")[1];
    expect(btn.textContent).toBe("B");
    btn.click();
    expect(btn.closest("th")!.getAttribute("aria-sort")).toBe("ascending");
    btn.click();
    expect(btn.closest("th")!.getAttribute("aria-sort")).toBe("descending");
    expect(col0(host)).toEqual(["a3", "a2", "a1"]);
    btn.click();
    expect(btn.closest("th")!.hasAttribute("aria-sort")).toBe(false);
    expect(col0(host)).toEqual(["a1", "a2", "a3"]);
    await wait(40);
    expect(host.querySelector(".atm-tables-live")!.textContent).toBe("Original order");
    host.remove();
  });
  it("is numeric-aware", () => {
    const p = createTablesPlugin({ sortable: true });
    const host = document.createElement("div");
    host.appendChild(renderDom("| n |\n| - |\n| 10 |\n| 9 |\n| 100 |", { postRender: [p.postRender!] }));
    host.querySelector<HTMLButtonElement>("th button")!.click();
    expect(Array.from(host.querySelectorAll("tbody td")).map((c) => c.textContent)).toEqual(["9", "10", "100"]);
  });
  it("hydrateAll on renderHtml output, idempotent", () => {
    const p = createTablesPlugin({ sortable: true });
    const host = document.createElement("div");
    host.innerHTML = renderHtml(T);
    hydrateAll(host, [p], T);
    hydrateAll(host, [p], T);
    expect(host.querySelectorAll("th button").length).toBe(3);
  });
  it("not sortable unless asked", () => {
    const host = document.createElement("div");
    host.appendChild(renderDom(T, { postRender: [createTablesPlugin().postRender!] }));
    expect(host.querySelector("th button")).toBeNull();
  });
  it("resizable: true puts handles in views too", () => {
    const host = view({ resizable: true });
    const seps = host.querySelectorAll("[role=separator]");
    expect(seps.length).toBe(3);
    host.remove();
  });
  it("in the editor while read-only; editing again restores the document order and never changes the Markdown", async () => {
    open({ sortable: true }, DOC, { readOnly: true });
    await wait(20);
    const btn = m!.surface.querySelector<HTMLButtonElement>("th button")!;
    expect(btn).toBeTruthy();
    btn.click();
    btn.click();
    expect(m!.surface.querySelector("tbody tr td")!.textContent).toBe("a3");
    expect(m!.ed.getValue()).toBe(DOC);
    m!.ed.setReadOnly(false);
    await wait(20);
    expect(m!.surface.querySelector("th button")).toBeNull();
    expect(m!.surface.querySelector("tbody tr td")!.textContent).toBe("a1");
    caretAfter(m!.surface, "Intro");
    m!.ed.insertText("!");
    expect(m!.ed.getValue()).toBe(DOC.replace("Intro", "Intro!"));
  });
});

describe("decorations never reach the Markdown", () => {
  it("getValue is identical before and after the handles are drawn", async () => {
    open({ sortable: true });
    const before = m!.ed.getValue();
    m!.surface.focus();
    caretAfter(m!.surface, "b2");
    await wait(50);
    expect(m!.ed.element.querySelector(".atm-tables-layer")).toBeTruthy();
    expect(m!.ed.getValue()).toBe(before);
    expect(m!.surface.querySelector(".atm-tables-layer, .atm-tables-live")).toBeNull();
  });
  it("cleanup removes everything", async () => {
    open();
    await wait(20);
    m!.ed.destroy();
    expect(document.querySelector(".atm-tables-layer, .atm-tables-live, .atm-tables-notice")).toBeNull();
  });
});
