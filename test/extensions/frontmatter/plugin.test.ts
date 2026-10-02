import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser";
import { renderDom, renderHtml } from "../../../src/render";
import { createFrontMatterPlugin, FRONT_MATTER_SYNTAX, getFrontMatter, hydrateFrontMatter, removeFrontMatter, setFrontMatter } from "../../../src/extensions/frontmatter";
import { mount, tick, wait, type Mounted } from "../../plugins/helpers";

const DOC = "---\ntitle: Project Alpha\ndraft: true\ntags: [notes, alpha]\n---\n\nBody text";
let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
});

async function setup(value = DOC, o: Parameters<typeof createFrontMatterPlugin>[0] = {}, extra: Record<string, unknown> = {}) {
  m = mount({ value, plugins: [createFrontMatterPlugin(o)], ...extra });
  await tick();
  return m;
}
const host = () => m!.surface.querySelector<HTMLElement>(".atm-custom-frontmatter")!;
const root = () => host().shadowRoot!;
const rows = () => Array.from(root().querySelectorAll(".atm-fm-row"));
const input = (key: string) => root().querySelector<HTMLInputElement>(`[data-fm-focus="value:${key}"]`)!;
const val = () => m!.ed.getValue().trimEnd();

function change(el: HTMLInputElement, v: string) {
  el.value = v;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("the editor block", () => {
  it("is one atomic block whose panel lives in a shadow root, and the Markdown is untouched", async () => {
    await setup();
    expect(host().getAttribute("contenteditable")).toBe("false");
    expect(host().shadowRoot).toBeTruthy();
    expect(rows().length).toBe(3);
    expect(host().querySelector(".atm-fm")).toBeNull(); // nothing in the light DOM
    expect(val()).toBe(DOC);
  });

  it("editing a value rewrites only that line, as one undo step", async () => {
    await setup();
    change(input("title"), "Project Beta");
    expect(val()).toBe(DOC.replace("Project Alpha", "Project Beta"));
    m!.ed.undo();
    await tick();
    expect(val()).toBe(DOC);
  });

  it("a switch writes true or false", async () => {
    await setup();
    const sw = input("draft");
    sw.checked = false;
    sw.dispatchEvent(new Event("change", { bubbles: true }));
    expect(val()).toBe(DOC.replace("draft: true", "draft: false"));
  });

  it("removing a property takes its lines away", async () => {
    await setup();
    root().querySelectorAll<HTMLButtonElement>(".atm-fm-remove")[1].click();
    expect(val()).toBe("---\ntitle: Project Alpha\ntags: [notes, alpha]\n---\n\nBody text");
  });

  it("adding a property: a name, a type and a value; a taken name is refused", async () => {
    await setup();
    root().querySelector<HTMLButtonElement>(".atm-fm-add-btn")!.click();
    const name = root().querySelector<HTMLInputElement>(".atm-fm-new-name")!;
    name.value = "title";
    root().querySelector<HTMLButtonElement>(".atm-fm-btn-primary")!.click();
    expect(root().querySelector(".atm-fm-error")!.textContent).toContain("title");
    expect(val()).toBe(DOC);
    name.value = "owner";
    root().querySelector<HTMLButtonElement>(".atm-fm-btn-primary")!.click();
    await tick();
    expect(val()).toContain("owner:");
    expect(rows().length).toBe(4);
  });

  it("a list property takes and drops items", async () => {
    await setup();
    const chip = root().querySelector<HTMLInputElement>(".atm-fm-chip-input")!;
    chip.value = "beta";
    chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(val()).toContain("beta");
    root().querySelector<HTMLButtonElement>(".atm-fm-chip-x")!.click();
    expect(val()).not.toContain("notes");
  });

  it("a line the panel cannot read is kept exactly as written", async () => {
    const md = "---\ntitle: A\nanchors: &a [1, 2]\nmulti: |\n  line one\n  line two\n---\n\nBody";
    await setup(md);
    change(input("title"), "B");
    expect(val()).toBe(md.replace("title: A", "title: B"));
  });

  it("is read-only when the editor is: no fields", async () => {
    await setup(DOC, {}, { readOnly: true });
    expect(root().querySelector("input,select,textarea")).toBeNull();
    expect(root().querySelector(".atm-fm-view")).toBeTruthy();
  });

  it("the Markdown view shows the YAML verbatim", async () => {
    await setup();
    m!.ed.setMode("markdown");
    await wait(60);
    const ta = m!.ed.element.querySelector("textarea")!;
    expect(ta.value.trimEnd()).toBe(DOC);
  });

  it("the collapse button toggles aria-expanded", async () => {
    await setup();
    const t = root().querySelector<HTMLButtonElement>(".atm-fm-toggle")!;
    expect(t.getAttribute("aria-expanded")).toBe("true");
    t.click();
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(root().querySelector<HTMLElement>(".atm-fm-body")!.hidden).toBe(true);
    expect(val()).toBe(DOC);
  });
});

describe("the API", () => {
  it("getFrontMatter reads a string or an editor", async () => {
    await setup();
    expect(getFrontMatter(DOC)!.data.title).toBe("Project Alpha");
    expect(getFrontMatter(m!.ed)!.data.draft).toBe(true);
    expect(getFrontMatter("no front matter")).toBeNull();
  });

  it("setFrontMatter patches, adds a block when there is none, and null removes it (WYSIWYG)", async () => {
    await setup("Just text");
    expect(setFrontMatter(m!.ed, { title: "New", count: 3 })).toBe(true);
    await tick();
    expect(val()).toBe("---\ntitle: New\ncount: 3\n---\n\nJust text");
    expect(setFrontMatter(m!.ed, { count: undefined })).toBe(true);
    expect(val()).toBe("---\ntitle: New\n---\n\nJust text");
    expect(removeFrontMatter(m!.ed)).toBe(true);
    await tick();
    expect(val()).toBe("Just text");
  });

  it("setFrontMatter works in the Markdown view and in read-only (refused)", async () => {
    await setup();
    m!.ed.setMode("markdown");
    await wait(60);
    expect(setFrontMatter(m!.ed, { title: "MD" })).toBe(true);
    expect(val()).toBe(DOC.replace("Project Alpha", "MD"));
    m!.ed.setReadOnly(true);
    expect(setFrontMatter(m!.ed, { title: "No" })).toBe(false);
  });

  it("the plugin command creates the block and an existing block is not duplicated", async () => {
    await setup("Hello");
    expect(m!.ed.exec("frontMatter")).toBe(true);
    await tick();
    expect(val().startsWith("---\n---")).toBe(true);
    m!.ed.exec("frontMatter");
    await tick();
    expect(m!.ed.getValue().match(/^---$/gm)!.length).toBe(2);
  });
});

describe("views and static HTML", () => {
  const syntax = { block: [FRONT_MATTER_SYNTAX] };

  it("renderDom + postRender gives a read-only definition list", () => {
    const plugin = createFrontMatterPlugin();
    const el = renderDom(DOC, { syntax, postRender: [plugin.postRender!] });
    const box = document.createElement("div");
    box.append(el);
    expect(box.querySelectorAll(".atm-fm-row").length).toBe(3);
    expect(box.querySelector("input,textarea")).toBeNull();
    expect(box.querySelector("time, .atm-fm-chip")).toBeTruthy();
  });

  it("renderHtml carries the YAML as data-yaml and hydrateFrontMatter fills it", () => {
    const html = renderHtml(DOC, { syntax });
    const box = document.createElement("div");
    box.innerHTML = html;
    expect(box.querySelector("[data-yaml]")).toBeTruthy();
    expect(hydrateFrontMatter(box)).toBe(1);
    expect(box.querySelectorAll(".atm-fm-row").length).toBe(3);
    expect(hydrateFrontMatter(box)).toBe(0); // idempotent
  });

  it("round trips byte for byte", () => {
    const doc = parse(DOC, { syntax });
    expect(stringify(doc, { syntax }).trimEnd()).toBe(DOC);
  });
});
