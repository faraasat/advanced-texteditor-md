import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createWikiLinks } from "../../../src/extensions/links/wiki";
import { caretAtEnd, mount, pressKey, typeInto, wait, type Mounted } from "../../plugins/helpers";
import { cleanupBody, key, menus, mountMd, options, preload, typeTA, until } from "../chips/md-helpers";
import { renderDom } from "../../../src/render";
import type { MentionItem } from "../../../src/types";

const PAGES: MentionItem[] = [
  { id: "p1", label: "Alpha plan", description: "Project Alpha" },
  { id: "p2", label: "Alpha notes" },
  { id: "p3", label: "Beta" },
];
const search = (q: string) => PAGES.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()));

const open: Mounted[] = [];
beforeAll(preload);
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  cleanupBody();
});
const keep = (m: Mounted) => (open.push(m), m);
const labelsOf = () => options().map((o) => o.querySelector(".atm-mention-label")?.textContent);

function setup(extra: Partial<Parameters<typeof createWikiLinks>[0]> = {}, value = "Note ") {
  const wiki = createWikiLinks({ search, ...extra });
  const m = keep(mount({ value, chips: wiki.chips, plugins: [wiki.plugin] }));
  caretAtEnd(m);
  return { wiki, m };
}

describe("createWikiLinks (shape)", () => {
  it("returns chips and a plugin, and no mentions entry (the editor would store the trigger in the chip)", () => {
    const w = createWikiLinks({ search });
    expect(w.chips).toHaveLength(1);
    expect(w.chips[0].scheme).toBe("wiki");
    expect(w.plugin.name).toBe("wiki-links");
    expect("mentions" in w).toBe(false);
    expect(w.scheme).toBe("wiki");
    expect(createWikiLinks({ search, scheme: "page" }).chips[0].scheme).toBe("page");
  });
});

describe("[[ typeahead in the Write view", () => {
  it("[[al lists matching pages; Enter makes a chip stored as [Title](wiki:id); one undo step", async () => {
    const { m } = setup();
    await typeInto(m.surface, "[[plan");
    await until(() => options().length === 1);
    expect(labelsOf()).toEqual(["Alpha plan"]);
    pressKey(m.surface, "Enter");
    await wait(10);
    expect(m.ed.getValue().trim()).toBe("Note [Alpha plan](wiki:p1)");
    expect(m.surface.querySelector(".atm-chip")?.textContent).toBe("Alpha plan"); // no "[[" shown or stored
    expect(menus().length).toBe(0);
    m.ed.undo();
    expect(m.ed.getValue().trim()).toBe("Note \\[\\[plan");
  });

  it("ArrowDown then Enter picks the second row; Escape closes without inserting", async () => {
    const { m } = setup();
    await typeInto(m.surface, "[[alpha");
    await until(() => options().length === 2);
    pressKey(m.surface, "ArrowDown");
    pressKey(m.surface, "Enter");
    await wait(10);
    expect(m.ed.getValue().trim()).toBe("Note [Alpha notes](wiki:p2)");
    await typeInto(m.surface, " [[be");
    await until(() => options().length === 1);
    pressKey(m.surface, "Escape");
    await wait(10);
    expect(menus().length).toBe(0);
    expect(m.ed.getValue()).toContain("\\[\\[be");
  });

  it("typing a normal link [text](url) never opens the menu and is left alone", async () => {
    const { m } = setup({}, "x ");
    await typeInto(m.surface, "[text](https://example.com)");
    await wait(160);
    expect(menus().length).toBe(0);
    expect(m.ed.getValue()).toContain("[text](https://example.com)");
    await typeInto(m.surface, " [one");
    await wait(160);
    expect(menus().length).toBe(0);
  });

  it("a [[ in the middle of a word does not open the menu", async () => {
    const { m } = setup({}, "word");
    await typeInto(m.surface, "[[al");
    await wait(160);
    expect(menus().length).toBe(0);
  });

  it("a [[ inside inline code does not open the menu", async () => {
    const { m } = setup({}, "see `code` end");
    const node = m.surface.querySelector("code")!.firstChild as Text;
    node.data = "[[al";
    const r = document.createRange();
    r.setStart(node, 4);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    node.parentElement!.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "l", bubbles: true }));
    await wait(200);
    expect(menus().length).toBe(0);
  });

  it("offers Create page when the host gives create(), and inserts what it returns", async () => {
    const create = vi.fn(async (q: string) => ({ id: "new1", label: q }));
    const { m } = setup({ create });
    await typeInto(m.surface, "[[Gamma");
    await until(() => options().length === 1);
    expect(labelsOf()[0]).toContain("Create page");
    expect(labelsOf()[0]).toContain("Gamma");
    pressKey(m.surface, "Enter");
    await until(() => m.ed.getValue().includes("wiki:new1"));
    expect(create).toHaveBeenCalledWith("Gamma", expect.anything());
    expect(m.ed.getValue().trim()).toBe("Note [Gamma](wiki:new1)");
  });

  it("no Create row when the typed text matches a page title exactly, or when create() is absent", async () => {
    const { m } = setup({ create: async (q) => ({ id: "x", label: q }) });
    await typeInto(m.surface, "[[Beta");
    await until(() => options().length === 1);
    expect(labelsOf()).toEqual(["Beta"]);
    const { m: m2 } = setup();
    caretAtEnd(m2);
    await typeInto(m2.surface, "[[zzz");
    await wait(200);
    expect(options().length).toBe(0);
  });

  it("a search that throws or rejects shows no rows and does not break typing", async () => {
    const { m } = setup({ search: () => Promise.reject(new Error("down")) });
    await typeInto(m.surface, "[[a");
    await wait(200);
    expect(options().length).toBe(0);
    await typeInto(m.surface, "b");
    expect(m.ed.getValue()).toContain("\\[\\[ab");
  });

  it("a closing bracket in the query ends the search", async () => {
    const s = vi.fn(search);
    const { m } = setup({ search: s });
    await typeInto(m.surface, "[[alp]");
    await wait(200);
    expect(options().length).toBe(0);
  });

  it("a page whose title has markup characters is stored escaped and parses back", async () => {
    const { m } = setup({ search: () => [{ id: "a/b?c=d", label: "Q&A [draft] *x*" }] });
    await typeInto(m.surface, "[[q");
    await until(() => options().length === 1);
    pressKey(m.surface, "Enter");
    await wait(10);
    const md = m.ed.getValue();
    expect(md).toContain("(wiki:a%2Fb%3Fc%3Dd)");
    m.ed.setValue(md);
    expect(m.ed.getValue()).toBe(md);
    expect(m.surface.querySelector(".atm-chip")?.getAttribute("data-id")).toBe("a/b?c=d");
  });
});

describe("[[ typeahead in the Markdown view", () => {
  it("[[be then Enter writes [Beta](wiki:p3) as one undo step", async () => {
    const wiki = createWikiLinks({ search });
    const { m, ta } = await mountMd({ value: "", chips: wiki.chips, plugins: [wiki.plugin] });
    keep(m);
    await typeTA(ta, "see [[be");
    await until(() => options().length === 1);
    key(ta, "Enter");
    await wait(10);
    expect(m.ed.getValue()).toBe("see [Beta](wiki:p3) ");
    m.ed.undo();
    expect(m.ed.getValue()).toBe("see [[be");
  });

  it("does not open inside a fenced block or an inline code span", async () => {
    const wiki = createWikiLinks({ search });
    const { m, ta } = await mountMd({ value: "", chips: wiki.chips, plugins: [wiki.plugin] });
    keep(m);
    await typeTA(ta, "```\n[[al");
    await wait(200);
    expect(menus().length).toBe(0);
    ta.value = "";
    ta.setSelectionRange(0, 0);
    await typeTA(ta, "`a [[al");
    await wait(200);
    expect(menus().length).toBe(0);
  });
});

describe("broken-link detection", () => {
  const md = "[Alpha plan](wiki:p1) and [Gone](wiki:gone) and [Beta](wiki:p3)\n";
  const resolve = async (ids: string[]) => Object.fromEntries(ids.map((i) => [i, { exists: i !== "gone", title: i === "p1" ? "Alpha plan v2" : undefined }]));

  it("marks a missing page with a class, data-atm-wiki, title and aria-description, and getValue is unchanged", async () => {
    const wiki = createWikiLinks({ search, resolve, resolveDelayMs: 10 });
    const m = keep(mount({ value: md, chips: wiki.chips, plugins: [wiki.plugin] }));
    const before = m.ed.getValue();
    const gone = await until(() => m.surface.querySelector<HTMLElement>('.atm-chip[data-id="gone"][data-atm-wiki="broken"]'));
    expect(gone.classList.contains("atm-wiki-broken")).toBe(true);
    expect(gone.getAttribute("title")).toBe("Page not found");
    expect(gone.getAttribute("aria-description")).toBe("Page not found");
    expect(gone.querySelector("*")).toBeNull(); // no decoration nodes
    expect(m.surface.querySelector('.atm-chip[data-id="p1"]')?.getAttribute("data-atm-wiki")).toBe("ok");
    expect(m.ed.getValue()).toBe(before);
    expect(wiki.status("gone")?.exists).toBe(false);
  });

  it("one batched call for all ids, deduplicated", async () => {
    const calls: string[][] = [];
    const wiki = createWikiLinks({ search, resolve: async (ids) => (calls.push(ids), Object.fromEntries(ids.map((i) => [i, { exists: true }]))), resolveDelayMs: 10 });
    keep(mount({ value: md + "[Again](wiki:p1)", chips: wiki.chips, plugins: [wiki.plugin] }));
    await until(() => calls.length);
    await wait(60);
    expect(calls).toEqual([["p1", "gone", "p3"]]);
  });

  it("decorates again after an edit adds a broken link, and after undo/redo re-render", async () => {
    const wiki = createWikiLinks({ search, resolve, resolveDelayMs: 10 });
    const m = keep(mount({ value: "plain ", chips: wiki.chips, plugins: [wiki.plugin] }));
    caretAtEnd(m);
    m.ed.insertMarkdown("[Gone](wiki:gone)");
    await until(() => m.surface.querySelector('[data-atm-wiki="broken"]'));
    m.ed.undo();
    m.ed.redo();
    await until(() => m.surface.querySelector('[data-atm-wiki="broken"]'));
    expect(m.ed.getValue()).toContain("[Gone](wiki:gone)");
  });

  it("works in the Markdown view too: statuses are known without chips", async () => {
    const wiki = createWikiLinks({ search, resolve, resolveDelayMs: 10 });
    const { m } = await mountMd({ value: md, chips: wiki.chips, plugins: [wiki.plugin] });
    keep(m);
    await until(() => wiki.status("gone"));
    expect(wiki.status("p3")?.exists).toBe(true);
  });

  it("a read-only view gets the same marks through postRender, plus role=link and keyboard open", async () => {
    const onOpen = vi.fn();
    const wiki = createWikiLinks({ search, resolve, resolveDelayMs: 10, onOpen });
    const view = document.createElement("div");
    view.append(renderDom(md, { chips: wiki.chips, postRender: [wiki.postRender] }));
    document.body.append(view);
    const gone = await until(() => view.querySelector<HTMLElement>('[data-id="gone"][data-atm-wiki="broken"]'));
    expect(gone.getAttribute("role")).toBe("link");
    expect(gone.getAttribute("tabindex")).toBe("0");
    gone.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(onOpen).toHaveBeenCalledWith("gone", expect.objectContaining({ id: "gone", scheme: "wiki" }), expect.anything());
    view.remove();
  });

  it("a failing resolve marks nothing and the document stays usable", async () => {
    const wiki = createWikiLinks({ search, resolve: async () => { throw new Error("offline"); }, resolveDelayMs: 10 });
    const m = keep(mount({ value: md, chips: wiki.chips, plugins: [wiki.plugin] }));
    await wait(80);
    expect(m.surface.querySelector("[data-atm-wiki]")).toBeNull();
  });

  it("destroying the last editor aborts the lookup in flight", async () => {
    let signal!: AbortSignal;
    const wiki = createWikiLinks({ search, resolve: (_ids, ctx) => ((signal = ctx.signal), new Promise(() => {})), resolveDelayMs: 0 });
    const m = mount({ value: md, chips: wiki.chips, plugins: [wiki.plugin] });
    await until(() => signal);
    m.destroy();
    expect(signal.aborted).toBe(true);
  });
});

describe("opening a page", () => {
  it("click on a wiki chip calls onOpen(id, chip) and does not navigate", async () => {
    const onOpen = vi.fn();
    const { m } = setup({ onOpen }, "[Alpha plan](wiki:p1) text");
    const chip = m.surface.querySelector<HTMLElement>(".atm-chip")!;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    chip.dispatchEvent(ev);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toBe("p1");
    expect(onOpen.mock.calls[0][1]).toMatchObject({ scheme: "wiki", id: "p1", label: "Alpha plan" });
  });

  it("Enter on a selected chip opens it; Enter elsewhere does not", async () => {
    const onOpen = vi.fn();
    const { m } = setup({ onOpen }, "[Alpha plan](wiki:p1) text");
    const chip = m.surface.querySelector<HTMLElement>(".atm-chip")!;
    const r = document.createRange();
    r.setStartBefore(chip);
    r.setEndAfter(chip);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r);
    const ev = pressKey(m.surface, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledWith("p1", expect.anything(), expect.anything());
    onOpen.mockClear();
    caretAtEnd(m);
    pressKey(m.surface, "Enter");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a throwing onOpen is contained", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { m } = setup({ onOpen: () => { throw new Error("boom"); } }, "[A](wiki:p1)");
    expect(() => m.surface.querySelector(".atm-chip")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))).not.toThrow();
    spy.mockRestore();
  });
});
