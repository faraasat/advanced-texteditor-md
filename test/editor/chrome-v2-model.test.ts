/**
 * Chrome v2, the pure parts: the toolbar model (groups, inline items, split / dropdown / colour,
 * priority overflow), palette ranking, slash sections, and the small maths the layouts lean on.
 */
import { describe, it, expect } from "vitest";
import {
  TOOLBAR_GROUPS,
  DEFAULT_GROUPS,
  groupOrder,
  resolveToolbarItems,
  overflowHidden,
  builtinToolbarItems,
  type ToolbarEntryItem,
} from "../../src/editor/toolbar";
import { score, rankCommands, humanize } from "../../src/editor/chrome/catalogue";
import { slashSections, builtinSlashItems, SLASH_LABELS } from "../../src/editor/slash";
import { keyboardInset } from "../../src/editor/layouts/mobile";
import { typewriterDelta } from "../../src/editor/chrome/typewriter";
import { lineCol, ZOOM_STEPS } from "../../src/editor/chrome/status-extra";
import { headingLines, inspect, inlineText } from "../../src/editor/layouts/sidebar";
import { contextOf } from "../../src/editor/chrome/context-menu";
import { fmt, textStats } from "../../src/editor/chrome/kit";
import { isTyping } from "../../src/editor/layouts/focus";
import { parse } from "../../src/parser/parse";
import { DEFAULT_LABELS, EXTRA_LABELS } from "../../src/editor/i18n";
import type { SlashItem } from "../../src/types";

const ids = (xs: (ToolbarEntryItem | "|")[]) => xs.map((x) => (x === "|" ? "|" : x.id));
const avail = builtinToolbarItems(DEFAULT_LABELS);

describe("toolbar model: groups", () => {
  it("the default order is derived from the default groups", () => {
    const out = ids(resolveToolbarItems(undefined, avail, []));
    expect(out).toEqual(ids(resolveToolbarItems(groupOrder(DEFAULT_GROUPS), avail, [])));
    expect(out.slice(0, 4)).toEqual(TOOLBAR_GROUPS.text);
    expect(out.slice(-2)).toEqual(TOOLBAR_GROUPS.history);
  });
  it("group names expand in place, with one separator between groups", () => {
    expect(ids(resolveToolbarItems(["history", "|", "text"], avail, []))).toEqual(["undo", "redo", "|", "bold", "italic", "strike", "code"]);
    expect(groupOrder(["text", "history"])).toEqual(["|", "text", "|", "history"]);
    expect(groupOrder(undefined)).toBeUndefined();
  });
  it("no leading, trailing or doubled separators", () => {
    expect(ids(resolveToolbarItems(["|", "|", "bold", "|", "|", "italic", "|"], avail, []))).toEqual(["bold", "|", "italic"]);
  });
  it("an id appears once, unknown ids are dropped", () => {
    expect(ids(resolveToolbarItems(["bold", "nope", "bold", "text"], avail, []))).toEqual(["bold", "italic", "strike", "code"]);
  });
  it("plugin items join their group, or the plugins group", () => {
    const a: ToolbarEntryItem = { id: "a", label: "A", command: "a", group: "text" };
    const b: ToolbarEntryItem = { id: "b", label: "B", command: "b" };
    const out = ids(resolveToolbarItems(["text", "|", "plugins"], avail, [a, b]));
    expect(out).toEqual(["bold", "italic", "strike", "code", "a", "|", "b"]);
  });
});

describe("toolbar model: item kinds", () => {
  it("inline objects are used as they are", () => {
    const out = resolveToolbarItems(["bold", { id: "x", label: "X", command: "x" }], avail, []);
    expect(ids(out)).toEqual(["bold", "x"]);
  });
  it("a split item becomes its button plus a chevron that owns the menu", () => {
    const split = { id: "h", label: "Heading", command: "heading", type: "split" as const, items: [{ label: "H1", command: "heading", args: 1 }, { label: "H2", command: "heading", args: 2 }] };
    const out = resolveToolbarItems([split], avail, [], "More") as ToolbarEntryItem[];
    expect(out.map((x) => x.id)).toEqual(["h", "h:menu"]);
    expect(out[0].menu).toBeUndefined();
    expect(out[1].split).toBe(true);
    expect(out[1].label).toBe("Heading (More)");
    expect(out[1].menu!.map((r) => [r.id, r.args])).toEqual([["h:0", 1], ["h:1", 2]]);
  });
  it("a dropdown gets its rows as a menu", () => {
    const dd = { id: "d", label: "Insert", command: "x", type: "dropdown" as const, items: [{ label: "Rule", command: "rule" }] };
    const [d] = resolveToolbarItems([dd], avail, []) as ToolbarEntryItem[];
    expect(d.menu).toEqual([{ id: "d:0", label: "Rule", command: "rule" }]);
  });
  it("a colour item gets one row per colour, with the colour as its argument", () => {
    const c = { id: "c", label: "Colour", command: "color", type: "color" as const, colors: ["#f00", { label: "Blue", value: "#00f" }] };
    const [d] = resolveToolbarItems([c], avail, []) as ToolbarEntryItem[];
    expect(d.menu!.map((r) => [r.label, r.args, r.color])).toEqual([["#f00", "#f00", "#f00"], ["Blue", "#00f", "#00f"]]);
  });
});

describe("toolbar model: priority overflow", () => {
  it("everything fits: nothing hides", () => {
    expect(overflowHidden([10, 10, 10], [0, 0, 0], 30, 10)).toEqual([false, false, false]);
  });
  it("equal priorities cut from the end, keeping room for More", () => {
    expect(overflowHidden([10, 10, 10, 10], [0, 0, 0, 0], 30, 10)).toEqual([false, false, true, true]);
  });
  it("the lowest priority goes first, wherever it sits", () => {
    expect(overflowHidden([10, 10, 10, 10], [5, 0, 5, 5], 36, 5)).toEqual([false, true, false, false]);
    expect(overflowHidden([10, 10, 10, 10], [-1, 9, 0, 9], 30, 5)).toEqual([true, false, true, false]);
  });
});

describe("palette ranking", () => {
  it("exact > prefix > word start > substring > subsequence > none", () => {
    const s = (t: string) => score(t, "bold");
    expect(s("Bold")).toBeGreaterThan(s("Bold text"));
    expect(s("Bold text")).toBeGreaterThan(s("Make bold"));
    expect(score("Make bold", "bold")).toBeGreaterThan(score("Unbolden", "bold"));
    expect(score("Unbolden", "bold")).toBeGreaterThan(score("B o l d", "bold"));
    expect(score("Italic", "bold")).toBe(0);
  });
  it("ignores case and accents; an empty query matches everything", () => {
    expect(score("Résumé", "resume")).toBe(1000);
    expect(score("anything", "  ")).toBe(1);
  });
  it("word starts across words: 'ins tab' finds Insert table", () => {
    expect(score("Insert table", "ins tab")).toBeGreaterThan(0);
  });
  it("ranks by label, then keywords and category; drops non-matches", () => {
    const es = [
      { id: "a", label: "Bold", category: "format" },
      { id: "b", label: "Strong text", keywords: ["bold"] },
      { id: "c", label: "Table" },
    ];
    expect(rankCommands(es, "bold").map((e) => e.id)).toEqual(["a", "b"]);
    expect(rankCommands(es, "form", [], { format: "Format" }).map((e) => e.id)).toEqual(["a"]);
  });
  it("recent commands lead an empty query, most recent first, and get a boost when filtering", () => {
    const es = [{ id: "a", label: "Heading 1" }, { id: "b", label: "Heading 2" }, { id: "c", label: "Heading 3" }];
    expect(rankCommands(es, "", ["c", "b"]).map((e) => e.id)).toEqual(["c", "b", "a"]);
    expect(rankCommands(es, "heading", ["c"]).map((e) => e.id)[0]).toBe("c");
  });
  it("humanize turns a command id into a label", () => {
    expect(humanize("insertTable")).toMatch(/^Insert table$/i);
  });
});

describe("slash v2: sections", () => {
  const items: SlashItem[] = [
    { id: "h1", label: "H1", group: "Basic", run: () => {} } as unknown as SlashItem,
    { id: "ul", label: "List", group: "Lists" } as unknown as SlashItem,
    { id: "h2", label: "H2", group: "Basic" } as unknown as SlashItem,
    { id: "x", label: "X" } as unknown as SlashItem,
  ];
  it("groups in first-seen order, ungrouped under the fallback", () => {
    expect(slashSections(items, [], "Recent", "Other").map((s) => [s.label, s.items.map((i) => i.id)])).toEqual([
      ["Basic", ["h1", "h2"]],
      ["Lists", ["ul"]],
      ["Other", ["x"]],
    ]);
  });
  it("recent items lead, and are not repeated in their group", () => {
    const out = slashSections(items, ["h2", "gone"], "Recent", "Other");
    expect(out[0]).toEqual({ label: "Recent", items: [items[2]] });
    expect(out[1].items.map((i) => i.id)).toEqual(["h1"]);
  });
  it("built-in items carry a group, a description, a preview and the live shortcut", () => {
    const b = builtinSlashItems({ ...DEFAULT_LABELS, ...EXTRA_LABELS } as unknown as Parameters<typeof builtinSlashItems>[0], {}, { images: true, shortcut: (c) => (c.startsWith("heading") ? "Mod-Alt-1" : undefined) });
    const h1 = b.find((i) => i.id === "heading1")!;
    expect(h1.group).toBe(SLASH_LABELS.slashBasic);
    expect(h1.description).toBeTruthy();
    expect(h1.preview).toBeTruthy();
    expect(h1.shortcut).toBe("Mod-Alt-1");
    const table = b.find((i) => i.id === "table");
    expect(table?.children?.length).toBeGreaterThan(0);
    for (const i of b) expect(i.group, i.id).toBeTruthy();
  });
});

describe("layout maths", () => {
  it("keyboardInset: only a real keyboard (> 80 px) counts", () => {
    expect(keyboardInset(800, null)).toBe(0);
    expect(keyboardInset(800, { height: 760, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(800, { height: 480, offsetTop: 0 })).toBe(320);
    expect(keyboardInset(800, { height: 480, offsetTop: 20 })).toBe(300);
  });
  it("typewriterDelta puts the caret at the ratio of the view", () => {
    expect(typewriterDelta(500, 0, 1000, 0.5)).toBe(0);
    expect(typewriterDelta(900, 0, 1000, 0.5)).toBe(400);
    expect(typewriterDelta(100, 100, 1100)).toBe(-450);
  });
  it("lineCol is 1-based and clamps", () => {
    expect(lineCol("ab\ncd", 0)).toEqual({ line: 1, col: 1 });
    expect(lineCol("ab\ncd", 4)).toEqual({ line: 2, col: 2 });
    expect(lineCol("ab", 99)).toEqual({ line: 1, col: 3 });
    expect(lineCol("ab", -5)).toEqual({ line: 1, col: 1 });
    expect(ZOOM_STEPS).toContain(100);
  });
  it("headingLines skips fenced code and needs a space after the hashes", () => {
    const md = "# A\ntext\n```\n# not\n```\n## B\n#nope\n~~~\n# no\n~~~\n   ### C";
    expect(headingLines(md)).toEqual([0, 5, 10]);
  });
  it("inspect lists headings, unique mentions, links and images in order", () => {
    const d = parse("# Title *one*\n\nSee [docs](https://x.test) and ![alt](a.png).\n\n## Two");
    const r = inspect(d);
    expect(r.headings.map((h) => [h.level, h.text])).toEqual([[1, "Title one"], [2, "Two"]]);
    expect(r.links).toEqual([{ text: "docs", href: "https://x.test", index: 0 }]);
    expect(r.images).toEqual([{ alt: "alt", src: "a.png", index: 0 }]);
    expect(inlineText([])).toBe("");
  });
  it("isTyping: printable keys, Enter, Backspace, Delete; not shortcuts or arrows", () => {
    const k = (key: string, o: KeyboardEventInit = {}) => isTyping(new KeyboardEvent("keydown", { key, ...o }));
    expect(k("a")).toBe(true);
    expect(k("Enter")).toBe(true);
    expect(k("Backspace")).toBe(true);
    expect(k("ArrowLeft")).toBe(false);
    expect(k("b", { ctrlKey: true })).toBe(false);
    expect(k("b", { metaKey: true })).toBe(false);
  });
  it("fmt fills placeholders and leaves unknown ones; textStats counts words and minutes", () => {
    expect(fmt("{n} of {m} {x}", { n: 1, m: 2 })).toBe("1 of 2 {x}");
    const t = textStats("one two three", 3);
    expect(t.words).toBe(3);
    expect(t.minutes).toBe(1);
    expect(textStats("").words).toBe(0);
  });
});

describe("context menu: contextOf", () => {
  const html = (s: string) => {
    const d = document.createElement("div");
    d.innerHTML = s;
    return d;
  };
  it("most specific first: chip > image > link > code > table > text", () => {
    const d = html('<a href="#"><span class="atm-chip"><b>c</b></span><img></a><pre><code>x</code></pre><table><tr><td><a href="#">l</a></td></tr></table><p>t</p>');
    expect(contextOf(d.querySelector("b"), "atm").kind).toBe("chip");
    expect(contextOf(d.querySelector("img"), "atm").kind).toBe("image");
    expect(contextOf(d.querySelector("code"), "atm").kind).toBe("code");
    expect(contextOf(d.querySelector("td a"), "atm").kind).toBe("link");
    expect(contextOf(d.querySelector("td"), "atm").kind).toBe("table");
    expect(contextOf(d.querySelector("p"), "atm")).toEqual({ kind: "text", el: d.querySelector("p") });
    expect(contextOf(null, "atm").kind).toBe("text");
  });
});
