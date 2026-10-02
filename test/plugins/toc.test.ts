import { afterEach, describe, expect, it } from "vitest";
import { parse, renderHtml, stringify } from "../../src/index";
import { buildOutline, createSlugger, createTocPlugin, getToc, hydrateToc, renderTocHtml, slugify } from "../../src/plugins/toc";
import { mount, selectText, tick, wait, type Mounted } from "./helpers";

describe("slugify", () => {
  const cases: [string, string][] = [
    ["Hello, World!", "hello-world"],
    ["  Multiple   spaces ", "multiple-spaces"],
    ["Café Crème", "cafe-creme"],
    ["日本語 タイトル", "日本語-タイトル"],
    ["snake_case and kebab-case", "snake_case-and-kebab-case"],
    ["C++ & C#", "c-c"],
    ["1. Intro", "1-intro"],
    ["Ünïcödé", "unicode"],
    ["!!!", "section"],
    ["", "section"],
    ["😀 emoji", "emoji"],
    ["A / B", "a-b"],
    ["Trailing - dash -", "trailing-dash"],
    ["ALL CAPS", "all-caps"],
  ];
  it.each(cases)("%j -> %j", (text, slug) => expect(slugify(text)).toBe(slug));
});

describe("createSlugger", () => {
  it("dedupes with -2, -3", () => {
    const s = createSlugger();
    expect([s("Intro"), s("Intro"), s("Intro"), s("Other")]).toEqual(["intro", "intro-2", "intro-3", "other"]);
  });
  it("never reuses a slug a heading already owns", () => {
    const s = createSlugger();
    expect([s("Intro"), s("Intro"), s("Intro 2")]).toEqual(["intro", "intro-2", "intro-2-2"]);
    const t = createSlugger();
    expect([t("Intro 2"), t("Intro"), t("Intro")]).toEqual(["intro-2", "intro", "intro-3"]);
  });
  it("is independent per slugger", () => {
    expect(createSlugger()("A")).toBe("a");
    expect(createSlugger()("A")).toBe("a");
  });
});

describe("buildOutline", () => {
  const doc = (md: string) => parse(md);
  it("lists headings with level, text and slug", () => {
    expect(buildOutline(doc("# One\n\ntext\n\n## Two\n\n### Three"))).toEqual([
      { level: 1, text: "One", slug: "one" },
      { level: 2, text: "Two", slug: "two" },
      { level: 3, text: "Three", slug: "three" },
    ]);
  });
  it("flattens inline formatting, links, code and chips", () => {
    const o = buildOutline(doc("## A **bold** `code` [link](https://a.io) and [@Jane](mention:person/1)"));
    expect(o[0].text).toBe("A bold code link and @Jane");
  });
  it("finds headings inside quotes, lists and containers", () => {
    const o = buildOutline(parse("> # Quoted\n\n- # In list\n\n::: note\n## In note\n:::", { syntax: { block: [{ name: "note" }] } }));
    expect(o.map((h) => h.text)).toEqual(["Quoted", "In list", "In note"]);
  });
  it("slugs are assigned over ALL headings so a level filter does not change them", () => {
    const md = "# Intro\n\n## Intro\n\n## Intro";
    expect(buildOutline(doc(md)).map((h) => h.slug)).toEqual(["intro", "intro-2", "intro-3"]);
    expect(buildOutline(doc(md), { minLevel: 2 }).map((h) => h.slug)).toEqual(["intro-2", "intro-3"]);
  });
  it("honours minLevel and maxLevel", () => {
    const md = "# A\n\n## B\n\n### C\n\n#### D";
    expect(buildOutline(doc(md), { minLevel: 2, maxLevel: 3 }).map((h) => h.text)).toEqual(["B", "C"]);
  });
  it("skips empty headings and ignores a toc block's own content", () => {
    expect(buildOutline(doc("#\n\n# Real"))).toEqual([{ level: 1, text: "Real", slug: "real" }]);
  });
  it("clamps nonsense levels", () => {
    expect(buildOutline(doc("# A"), { minLevel: 0, maxLevel: 99 })).toHaveLength(1);
    expect(buildOutline(doc("# A"), { minLevel: 5, maxLevel: 2 })).toEqual([]);
  });
});

describe("markdown representation", () => {
  const plugin = createTocPlugin();
  const o = { syntax: plugin.syntax };
  it("round-trips ::: toc", () => {
    expect(stringify(parse("# A\n\n::: toc\n:::\n\n## B", o), o)).toBe("# A\n\n::: toc\n:::\n\n## B");
  });
  it("round-trips level options", () => {
    expect(stringify(parse("::: toc min=2 max=3\n:::", o), o)).toBe("::: toc min=2 max=3\n:::");
  });
  it("renders an empty container for a static view", () => {
    const html = renderHtml(parse("::: toc\n:::", o), o);
    expect(html).toContain("atm-toc");
    expect(html).toContain('role="navigation"');
  });
  it("renderTocHtml escapes and links", () => {
    const html = renderTocHtml([{ level: 2, text: "A <b> & \"c\"", slug: "a-b-c" }]);
    expect(html).toContain('href="#a-b-c"');
    expect(html).toContain("A &lt;b&gt; &amp; &quot;c&quot;");
    expect(html).toContain("atm-toc-l2");
    expect(html).not.toContain("<b>");
  });
});

describe("hydrateToc (read-only views)", () => {
  it("adds ids to headings and fills the toc blocks", () => {
    const plugin = createTocPlugin();
    const o = { syntax: plugin.syntax };
    const d = parse("# Title\n\n::: toc\n:::\n\n## Part\n\n## Part", o);
    const root = document.createElement("div");
    root.innerHTML = renderHtml(d, o);
    hydrateToc(root, d);
    expect(Array.from(root.querySelectorAll("h1,h2")).map((h) => h.id)).toEqual(["title", "part", "part-2"]);
    const links = Array.from(root.querySelectorAll(".atm-toc a")).map((a) => a.getAttribute("href"));
    expect(links).toEqual(["#title", "#part", "#part-2"]);
  });
  it("honours per-block min/max", () => {
    const plugin = createTocPlugin();
    const o = { syntax: plugin.syntax };
    const d = parse("# T\n\n::: toc min=2\n:::\n\n## P\n\n### Q", o);
    const root = document.createElement("div");
    root.innerHTML = renderHtml(d, o);
    hydrateToc(root, d);
    expect(Array.from(root.querySelectorAll(".atm-toc a")).map((a) => a.textContent)).toEqual(["P", "Q"]);
  });
});

/* ───────────────────────────── in the editor ───────────────────────────── */

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  document.head.querySelectorAll("style[data-atm-plugin]").forEach((e) => e.remove());
});

const mk = (value: string, options = {}, mountOptions: Parameters<typeof mount>[0] = {}) => {
  m = mount({ plugins: [createTocPlugin({ debounceMs: 10, ...options })], value, ...mountOptions });
  return m;
};
const tocEl = () => m!.surface.querySelector<HTMLElement>(".atm-custom-toc")!;
const links = () => Array.from(tocEl().shadowRoot!.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);

describe("the editor", () => {
  it("renders a live, non-editable outline that is not part of the stored markdown", async () => {
    const md = "# Intro\n\n::: toc\n:::\n\n## Part one\n\n## Part two";
    mk(md);
    await wait(40);
    expect(tocEl().getAttribute("contenteditable")).toBe("false");
    expect(links()).toEqual([
      ["Intro", "#intro"],
      ["Part one", "#part-one"],
      ["Part two", "#part-two"],
    ]);
    expect(m!.ed.getValue()).toBe(md);
    // and after an edit elsewhere the markdown is still free of generated content
    selectText(m!.surface, "Part two");
    m!.ed.insertText("Part 2");
    await wait(40);
    expect(m!.ed.getValue()).toBe(md.replace("Part two", "Part 2"));
  });
  it("gives headings stable slugs in data-atm-slug, deduped", async () => {
    mk("# Intro\n\n## Intro\n\n## Intro\n\n::: toc\n:::");
    await wait(40);
    expect(Array.from(m!.surface.querySelectorAll("h1,h2")).map((h) => h.getAttribute("data-atm-slug"))).toEqual(["intro", "intro-2", "intro-3"]);
  });
  it("updates when a heading changes", async () => {
    mk("# Intro\n\n::: toc\n:::");
    await wait(40);
    selectText(m!.surface, "Intro");
    m!.ed.insertText("Overview");
    await wait(60);
    expect(links()).toEqual([["Overview", "#overview"]]);
    expect(m!.surface.querySelector("h1")!.getAttribute("data-atm-slug")).toBe("overview");
  });
  it("updates after setValue", async () => {
    mk("# A\n\n::: toc\n:::");
    await wait(40);
    m!.ed.setValue("# B\n\n## C\n\n::: toc\n:::");
    await wait(40);
    expect(links().map((l) => l[0])).toEqual(["B", "C"]);
  });
  it("insertToc inserts the block", async () => {
    mk("# Intro\n\ntext");
    selectText(m!.surface, "text");
    expect(m!.ed.exec("insertToc")).toBe(true);
    await wait(40);
    expect(m!.ed.getValue()).toContain("::: toc\n:::");
    expect(m!.surface.querySelector(".atm-custom-toc")).toBeTruthy();
    expect(links()).toEqual([["Intro", "#intro"]]);
  });
  it("minLevel/maxLevel from the plugin and from the block", async () => {
    mk("# A\n\n## B\n\n### C\n\n::: toc min=2 max=2\n:::", {});
    await wait(40);
    expect(links().map((l) => l[0])).toEqual(["B"]);
    m!.destroy();
    mk("# A\n\n## B\n\n### C\n\n::: toc\n:::", { minLevel: 2, maxLevel: 3 });
    await wait(40);
    expect(links().map((l) => l[0])).toEqual(["B", "C"]);
  });
  it("an empty document says so", async () => {
    mk("::: toc\n:::");
    await wait(40);
    expect(tocEl().shadowRoot!.textContent).toContain("No headings");
  });
  it("is keyboard navigable: links are tabbable and the arrows move between them", async () => {
    mk("# A\n\n## B\n\n## C\n\n::: toc\n:::");
    await wait(40);
    const root = tocEl().shadowRoot!;
    const a = Array.from(root.querySelectorAll("a"));
    a[0].focus();
    a[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(root.activeElement).toBe(a[1]);
    a[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(root.activeElement).toBe(a[2]);
    a[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(root.activeElement).toBe(a[0]);
    expect(a.every((x) => x.tabIndex === 0)).toBe(true);
  });
  it("activating a link scrolls to the heading and puts the caret there", async () => {
    mk("# A\n\n## Target\n\n::: toc\n:::");
    await wait(40);
    let scrolled = 0;
    const h = m!.surface.querySelector<HTMLElement>('[data-atm-slug="target"]')!;
    h.scrollIntoView = () => void scrolled++;
    const a = tocEl().shadowRoot!.querySelectorAll("a")[1];
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(scrolled).toBe(1);
    expect(document.getSelection()!.anchorNode && h.contains(document.getSelection()!.anchorNode)).toBe(true);
  });
  it("getToc reads the outline from the editor, in any mode", async () => {
    mk("# A\n\n## B\n\n## B", {}, { mode: "markdown" });
    expect(getToc(m!.ed)).toEqual([
      { level: 1, text: "A", slug: "a" },
      { level: 2, text: "B", slug: "b" },
      { level: 2, text: "B", slug: "b-2" },
    ]);
    expect(getToc(m!.ed, { minLevel: 2 })).toHaveLength(2);
  });
  it("split mode: the preview is hydrated too", async () => {
    mk("# A\n\n## B\n\n::: toc\n:::", {}, { mode: "split" });
    await wait(80);
    const pre = m!.ed.element.querySelector(".atm-preview")!;
    expect(Array.from(pre.querySelectorAll(".atm-toc a")).map((a) => a.getAttribute("href"))).toEqual(["#a", "#b"]);
    expect(pre.querySelector("h2")!.id).toBe("b");
  });
  it("stops observing on destroy", async () => {
    mk("# A\n\n::: toc\n:::");
    await wait(30);
    const surface = m!.surface;
    m!.destroy();
    m = null;
    surface.appendChild(document.createElement("p"));
    await tick();
  });
});
