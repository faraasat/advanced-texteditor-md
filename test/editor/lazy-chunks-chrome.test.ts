/**
 * The COLD path for chrome v2: the palette, the context menu, settings, status bar v2 and the new
 * layouts are lazy chunks. A plain editor fetches none of them; each is fetched on first use, and
 * one that cannot be fetched leaves the editor working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CE = typeof import("../../src/editor/create-editor");
type LC = typeof import("../../src/editor/lazy-chunks");
type EditorInstance = import("../../src/types").EditorInstance;

let createEditor: CE["createEditor"];
let chunks: LC["chunks"];
const live: EditorInstance[] = [];
const hosts: HTMLElement[] = [];
const CHROME = ["palette", "context", "settings", "status", "ribbon", "sidebar", "focus", "tabs", "mobile"] as const;

beforeEach(async () => {
  vi.resetModules();
  ({ createEditor } = await import("../../src/editor/create-editor"));
  ({ chunks } = await import("../../src/editor/lazy-chunks"));
});
afterEach(() => {
  while (live.length) live.pop()!.destroy();
  while (hosts.length) hosts.pop()!.remove();
  vi.doUnmock("../../src/editor/chrome/palette");
  vi.doUnmock("../../src/editor/layouts/ribbon");
});

function make(options: Parameters<CE["createEditor"]>[1] = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const ed = createEditor(host, options);
  live.push(ed);
  return { ed, host, editable: host.querySelector<HTMLElement>("[contenteditable]")! };
}
const got = (name: (typeof CHROME)[number]) => !!(chunks as unknown as Record<string, { get(): unknown }>)[name].get();
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

describe("chrome v2 chunks are fetched only on use", () => {
  it("a classic editor fetches none of them", async () => {
    make({ value: "# Title\n\ntext" });
    await wait();
    for (const n of CHROME) expect(got(n), n).toBe(false);
  });
  it("the palette chunk arrives on the first Mod-Shift-P, and the dialog with it", async () => {
    const { ed, host } = make({ value: "x" });
    expect(ed.exec("palette")).toBe(true);
    await vi.waitFor(() => expect(host.querySelector(".atm-palette")).not.toBeNull());
    expect(got("palette")).toBe(true);
    expect(got("context")).toBe(false);
  });
  it("a layout fetches its own chunk only", async () => {
    const { host } = make({ layout: "ribbon" });
    // The flat toolbar is drawn at once (the skeleton hides it) and swapped for the ribbon.
    expect(host.querySelector(".atm-toolbar")).not.toBeNull();
    await vi.waitFor(() => expect(host.querySelector(".atm-ribbon-tabs")).not.toBeNull());
    expect(got("ribbon")).toBe(true);
    for (const n of CHROME.filter((n) => n !== "ribbon")) expect(got(n), n).toBe(false);
  });
  it("statusBar.items and settings.storage fetch their chunks", async () => {
    make({ statusBar: { items: ["words", "zoom"] }, settings: { storage: { getItem: () => null, setItem: () => {} } } });
    await vi.waitFor(() => expect(got("status") && got("settings")).toBe(true));
  });
});

describe("a chrome chunk that cannot be fetched", () => {
  it("palette: the command still answers and the editor keeps working", async () => {
    vi.doMock("../../src/editor/chrome/palette", () => {
      throw new Error("offline");
    });
    const { ed, host } = make({ value: "hello" });
    expect(ed.exec("palette")).toBe(true);
    await wait();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(ed.getValue()).toBe("hello");
    ed.setValue("bye");
    expect(ed.getValue()).toBe("bye");
  });
  it("ribbon: the flat toolbar stays usable", async () => {
    vi.doMock("../../src/editor/layouts/ribbon", () => {
      throw new Error("offline");
    });
    const { host } = make({ layout: "ribbon" });
    await wait();
    expect(host.querySelector(".atm-ribbon-tabs")).toBeNull();
    expect(host.querySelectorAll(".atm-toolbar .atm-btn").length).toBeGreaterThan(3);
  });
});
