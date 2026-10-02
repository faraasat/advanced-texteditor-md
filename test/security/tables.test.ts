import { afterEach, describe, expect, it } from "vitest";
import { parse } from "../../src/parser";
import { renderDom, renderHtml } from "../../src/render";
import { hydrateAll } from "../../src/plugins/hydrate";
import { convertCsv, createTablesPlugin, csvToTable, findTable, formatTable, rowsToTable, tsvRows } from "../../src/extensions/tables";
import { caretAfter, mount, tick, wait, type Mounted } from "../plugins/helpers";
import { HTML, MARKDOWN } from "./vectors";
import { expectLinear } from "../extensions/tables/linear";

/**
 * Hostile cells through every door the tables plugin has: CSV import, TSV paste, spreadsheet HTML
 * paste, sorting a view, the Markdown-mode rewrite. The checker shares no code with the library.
 */
const SAFE = new Set(["http", "https", "mailto", "tel"]);
function unsafe(root: ParentNode): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((e) => {
    const tag = e.tagName.toUpperCase();
    if (/^(SCRIPT|IFRAME|OBJECT|EMBED|BASE|META|LINK|FORM|STYLE)$/.test(tag)) out.push(`<${tag}>`);
    for (const a of Array.from(e.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) out.push(`${tag}[${n}]`);
      if (["href", "src", "action", "xlink:href", "formaction", "data"].includes(n)) {
        const m = /^([a-z][a-z0-9+.-]*):/.exec(a.value.replace(/[\u0000- \u007f-\u009f​-‍﻿]/g, "").toLowerCase());
        if (m && !SAFE.has(m[1])) out.push(`${tag}[${n}=${a.value}]`);
      }
      if (n === "style" && /url\s*\(|expression|javascript:|@import/i.test(a.value)) out.push(`${tag}[style=${a.value}]`);
    }
  });
  if ((window as unknown as { __xss?: unknown }).__xss !== undefined) out.push("window.__xss was set");
  return out;
}

const X = "window.__xss=1";
const CELLS = [
  `<img src=x onerror="${X}">`,
  `"><svg onload=${X}>`,
  `[click](javascript:${X})`,
  `[a](JaVaScRiPt:${X})`,
  `<javascript:${X}>`,
  `![i](data:image/svg+xml,<svg onload=${X}>)`,
  `[v](vbscript:msgbox(1))`,
  `a|b|c`,
  `\\|escaped\\`,
  `| --- |`,
  "‮evil‬ zero​width",
  `<style>@import "javascript:${X}"</style>`,
  `expression(alert(1))`,
  ...MARKDOWN.slice(0, 20),
];

const csv = (cells: string[]) => "h1,h2\n" + cells.map((c) => `"${c.replace(/"/g, '""')}",x`).join("\n");

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  delete (window as unknown as { __xss?: unknown }).__xss;
});

describe("CSV import of hostile cells", () => {
  it("every cell is one literal cell: no element, no link, no extra column", () => {
    const md = csvToTable(csv(CELLS));
    const t = parse(md).children[0];
    expect(t.type).toBe("table");
    if (t.type !== "table") return;
    expect(t.rows.length).toBe(CELLS.length);
    for (const r of t.rows) expect(r.length).toBe(2);
    t.rows.forEach((r) => {
      for (const n of r[0]) expect(["text", "break"]).toContain(n.type);
    });
    const holder = document.createElement("div");
    holder.appendChild(renderDom(md));
    expect(unsafe(holder)).toEqual([]);
    expect(holder.querySelectorAll("tbody a, tbody img").length).toBe(0);
    expect(holder.querySelectorAll("tbody tr").length).toBe(CELLS.length);
  });
  it("a pipe in a value can never add or shift a column", () => {
    const md = rowsToTable([["a", "b"], ["x | y | z", "|"]]);
    const t = parse(md).children[0] as Extract<ReturnType<typeof parse>["children"][0], { type: "table" }>;
    expect(t.rows[0].length).toBe(2);
    expect(t.rows[0].map((c) => c.map((n) => (n as { value?: string }).value).join(""))).toEqual(["x | y | z", "|"]);
  });
  it("__proto__ / constructor header names pollute nothing", () => {
    const md = csvToTable("__proto__,constructor,prototype\n1,2,3");
    expect(md).toContain("| \\_\\_proto\\_\\_ | constructor | prototype |");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "1")).toBe(false);
    const holder = document.createElement("div");
    const p = createTablesPlugin({ sortable: true });
    holder.appendChild(renderDom("| __proto__ | constructor |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |", { postRender: [p.postRender!] }));
    holder.querySelector<HTMLButtonElement>("th button")!.click();
    expect(unsafe(holder)).toEqual([]);
  });
  it("100k cells convert in linear time (limits off), and the default caps refuse them", () => {
    const make = (n: number) => Array.from({ length: n / 10 }, (_, i) => Array.from({ length: 10 }, (_, j) => `"<b>${i}|${j}</b>"`).join(",")).join("\n");
    expect(() => convertCsv(make(100_000))).toThrow(/too-many-rows|too-large/);
    expectLinear((n) => {
      const text = make(n);
      return () => void convertCsv(text, { maxBytes: Infinity, maxRows: Infinity, maxColumns: Infinity });
    }, 25_000);
  });
  it("hostile quoting (unbalanced, nested, lone CR) stays linear and never throws", () => {
    const evil = ['"'.repeat(5000), '",'.repeat(5000), "\r".repeat(5000), 'a"b"c"'.repeat(2000)];
    for (const e of evil) expect(() => convertCsv("h\n" + e, { maxBytes: Infinity, maxRows: Infinity, maxColumns: Infinity })).not.toThrow(/^(?!tables)/);
    expectLinear((n) => {
      const text = "h\n" + '"a""'.repeat(n);
      return () => void convertCsv(text, { maxBytes: Infinity, maxRows: Infinity, maxColumns: Infinity });
    }, 20_000);
  });
  it("the Markdown-mode table finder is linear on pathological pipes", () => {
    expectLinear((n) => {
      const src = "| a |\n| - |\n" + "|\\".repeat(n) + "\n";
      return () => void formatTable(findTable(src, 3)!.grid);
    }, 20_000);
  });
});

/** A paste event with clipboard data (jsdom has no DataTransfer). */
function paste(target: HTMLElement, data: Record<string, string>): void {
  const ev = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => data[k] ?? "", files: [], items: [], types: Object.keys(data) } });
  target.dispatchEvent(ev);
}

describe("paste of hostile spreadsheet data", () => {
  it("TSV: cells are text in the editor and in the Markdown", async () => {
    m = mount({ value: "s", plugins: [createTablesPlugin()] });
    caretAfter(m.surface, "s");
    const tsv = "h1\th2\n" + CELLS.map((c) => `"${c.replace(/"/g, '""')}"\tx`).join("\n");
    expect(tsvRows(tsv, false)!.length).toBe(CELLS.length + 1);
    paste(m.surface, { "text/plain": tsv });
    await tick();
    expect(m.surface.querySelectorAll("table tbody tr").length).toBe(CELLS.length);
    expect(m.surface.querySelectorAll("table a, table img").length).toBe(0);
    expect(unsafe(m.ed.element)).toEqual([]);
    const t = parse(m.ed.getValue()).children[1];
    expect(t.type === "table" && t.rows.every((r) => r.length === 2)).toBe(true);
  });
  it("spreadsheet HTML: parsed inertly, only text is kept", async () => {
    m = mount({ value: "s", plugins: [createTablesPlugin()] });
    caretAfter(m.surface, "s");
    const cells = [...CELLS, ...HTML.slice(0, 15)];
    const html =
      '<meta name="generator" content="Excel"><table><colgroup><col width=80></colgroup>' +
      cells.map((c) => `<tr><td>${c}</td><td><a href="javascript:${X}">l</a><img src=x onerror="${X}"></td></tr>`).join("") +
      "</table>";
    paste(m.surface, { "text/plain": "not tsv", "text/html": html });
    await wait(20);
    expect(m.surface.querySelector("table")).toBeTruthy();
    expect(m.surface.querySelectorAll("table a, table img, table svg, table script").length).toBe(0);
    expect(unsafe(m.ed.element)).toEqual([]);
    // The stored Markdown may hold the hostile text, but only escaped: it parses to text, never a link.
    const t = parse(m.ed.getValue()).children.find((b) => b.type === "table");
    expect(t && t.type === "table" && t.rows.flat(2).some((n) => n.type === "link" || n.type === "image")).toBe(false);
  });
  it("inside a cell, values go in as text nodes", async () => {
    m = mount({ value: "| A | B |\n| - | - |\n| 1 | 2 |", plugins: [createTablesPlugin()] });
    caretAfter(m.surface, "1");
    paste(m.surface, { "text/plain": `<img src=x onerror="${X}">\t[x](javascript:${X})\na|b\tc` });
    await tick();
    expect(m.surface.querySelectorAll("table img, table a").length).toBe(0);
    expect(unsafe(m.ed.element)).toEqual([]);
    const t = parse(m.ed.getValue()).children[0];
    expect(t.type === "table" && t.head.length).toBe(2);
  });
});

describe("views and labels", () => {
  it("sort buttons over hostile header text, renderHtml + hydrateAll", () => {
    const md = csvToTable("h\n" + CELLS.map((c) => `"${c.replace(/"/g, '""')}"`).join("\n"));
    const host = document.createElement("div");
    host.innerHTML = renderHtml(md);
    const p = createTablesPlugin({ sortable: true, resizable: true });
    hydrateAll(host, [p], md);
    host.querySelector<HTMLButtonElement>("th button")!.click();
    host.querySelector<HTMLButtonElement>("th button")!.click();
    expect(unsafe(host)).toEqual([]);
  });
  it("host labels are text, never markup", async () => {
    const evil = `<img src=x onerror="${X}">`;
    m = mount({ value: "P", plugins: [createTablesPlugin({ labels: { importCsv: evil, tooManyRows: evil + "{max}", resizeColumn: evil, dismiss: evil }, limits: { maxRows: 1 } })] });
    caretAfter(m.surface, "P");
    m.ed.exec("tableImport", "h\n1\n2");
    await wait(40);
    expect(unsafe(m.ed.element)).toEqual([]);
    expect(m.ed.element.querySelector(".atm-tables-notice")!.textContent).toContain("<img");
  });
});
