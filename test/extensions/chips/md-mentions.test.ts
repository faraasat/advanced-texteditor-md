import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createMarkdownMentionsPlugin } from "../../../src/extensions/chips/md-mentions";
import { wait, type Mounted } from "../../plugins/helpers";
import { cleanupBody, key, menus, mountMd, options, typeTA, preload } from "./md-helpers";
import type { MentionItem, MentionOptions } from "../../../src/types";

const people: MentionItem[] = [
  { id: "u1", label: "Jane Doe", kind: "person", refs: { crm: "12" }, badge: "Team" },
  { id: "u2", label: "Jan [Smith]", kind: "person" },
  { id: "u3", label: "Bob", kind: "bot" },
];
const search: MentionOptions["search"] = (q) => people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()));
const open: Mounted[] = [];
beforeAll(preload);
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  cleanupBody();
});
async function setup(mentions: MentionOptions | MentionOptions[] = { search }, extra = {}) {
  const r = await mountMd({ mentions, plugins: [createMarkdownMentionsPlugin()], ...extra });
  open.push(r.m);
  return r;
}

describe("Markdown pane mentions", () => {
  it("typing @ opens the shared menu; ArrowDown + Enter inserts the escaped wire text", async () => {
    const { m, ta } = await setup();
    await typeTA(ta, "Hi @ja");
    await wait(150); // the first query is immediate, later keystrokes are debounced (100 ms)
    expect(menus().length).toBe(1);
    const opts = options();
    expect(opts.map((o) => o.textContent)).toEqual(["JDJane DoeTeam", "J[Jan [Smith]"]);
    expect(document.querySelector(".atm-mention-list")!.getAttribute("role")).toBe("listbox");
    // a textbox: aria-controls + aria-activedescendant, never aria-expanded / aria-haspopup
    expect(ta.getAttribute("aria-controls")).toBe(document.querySelector(".atm-mention-list")!.id);
    expect(ta.getAttribute("aria-activedescendant")).toBe(opts[0].id);
    expect(ta.hasAttribute("aria-expanded")).toBe(false);
    expect(ta.hasAttribute("aria-haspopup")).toBe(false);
    expect(key(ta, "ArrowDown").defaultPrevented).toBe(true);
    expect(ta.getAttribute("aria-activedescendant")).toBe(opts[1].id);
    key(ta, "Enter");
    expect(m.ed.getValue()).toBe("Hi [@Jan \\[Smith\\]](mention:person/u2) ");
    expect(menus().length).toBe(0);
    expect(ta.hasAttribute("aria-controls")).toBe(false);
    // the stored text parses as the chip
    expect(m.ed.getMentions()).toEqual([{ type: "chip", scheme: "mention", kind: "person", id: "u2", label: "Jan [Smith]", trigger: "@" }]);
  });

  it("refs are carried and the pick is ONE undo step", async () => {
    const { m, ta } = await setup();
    await typeTA(ta, "@jane");
    await wait(150);
    key(ta, "Enter");
    expect(m.ed.getValue()).toBe("[@Jane Doe](mention:person/u1?crm=12) ");
    m.ed.undo();
    expect(m.ed.getValue()).toBe("@jane");
    m.ed.redo();
    expect(m.ed.getValue()).toBe("[@Jane Doe](mention:person/u1?crm=12) ");
  });

  it("Home / End / ArrowUp wrap, Tab picks, click picks", async () => {
    const { m, ta } = await setup();
    await typeTA(ta, "@");
    const opts = options();
    expect(opts.length).toBe(3);
    key(ta, "End");
    expect(ta.getAttribute("aria-activedescendant")).toBe(opts[2].id);
    key(ta, "Home");
    key(ta, "ArrowUp");
    expect(ta.getAttribute("aria-activedescendant")).toBe(opts[2].id);
    key(ta, "Tab");
    expect(m.ed.getValue()).toBe("[@Bob](mention:bot/u3) ");
    await typeTA(ta, "@ja");
    await wait(150);
    options()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(m.ed.getValue()).toContain("[@Jane Doe](mention:person/u1?crm=12) ");
  });

  it("Escape closes, stops propagation only while open, and the same @ does not reopen", async () => {
    const { ta } = await setup();
    const outer = vi.fn();
    document.body.addEventListener("keydown", outer);
    await typeTA(ta, "@ja");
    const ev = key(ta, "Escape");
    expect(ev.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(menus().length).toBe(0);
    await typeTA(ta, "n");
    expect(menus().length).toBe(0);
    key(ta, "Escape");
    expect(outer).toHaveBeenCalledTimes(1); // closed: Escape is the host's again
    await typeTA(ta, " @b");
    expect(menus().length).toBe(1);
    document.body.removeEventListener("keydown", outer);
  });

  it("nothing happens during an IME composition (typing @ then composing 张)", async () => {
    const { m, ta } = await setup({ search: (q) => [{ id: "z", label: "张伟" }].filter((p) => p.label.includes(q)) });
    await typeTA(ta, "@");
    expect(options().length).toBe(1);
    ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
    // the browser updates the value and fires input events while composing
    ta.value = "@zh";
    ta.setSelectionRange(3, 3);
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", data: "zh", bubbles: true, isComposing: true }));
    // Enter during composition commits the IME text, it must not pick
    const enter = key(ta, "Enter", { isComposing: true });
    expect(enter.defaultPrevented).toBe(false);
    expect(m.ed.getValue()).toBe("@zh");
    ta.value = "@张";
    ta.setSelectionRange(2, 2);
    ta.dispatchEvent(new CompositionEvent("compositionend", { data: "张" }));
    await wait(10);
    expect(options().map((o) => o.textContent)).toEqual(["张张伟"]);
    key(ta, "Enter");
    expect(m.ed.getValue()).toBe("[@张伟](mention:z) ");
  });

  it("several triggers, schemes, minChars, hideWhenEmpty, groupBy and renderItem", async () => {
    const { m, ta } = await setup([
      { search, minChars: 2 },
      {
        trigger: "#",
        scheme: "tag",
        hideWhenEmpty: true,
        allowSpaces: false,
        search: (q) => [{ id: "bug", label: "bug" }, { id: "build", label: "build", kind: "ci" }].filter((t) => t.label.startsWith(q)),
        groupBy: (i) => (i.kind ? "CI" : "Tags"),
        renderItem: (i) => `tag ${i.label}`,
      },
    ]);
    await typeTA(ta, "@j");
    expect(menus().length).toBe(0); // minChars 2
    await typeTA(ta, "a");
    await wait(150);
    expect(options().length).toBe(2);
    key(ta, "Escape");
    await typeTA(ta, " #zz");
    await wait(150);
    expect(menus().length).toBe(0); // hideWhenEmpty
    ta.value = ta.value.slice(0, -2);
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward", bubbles: true }));
    await typeTA(ta, "b");
    await wait(150);
    expect(Array.from(document.querySelectorAll(".atm-mention-group")).map((g) => g.textContent)).toEqual(["Tags", "CI"]);
    expect(options().map((o) => o.textContent)).toEqual(["tag bug", "tag build"]);
    key(ta, "Enter");
    expect(m.ed.getValue()).toBe("@ja [#bug](tag:bug) ");
  });

  it("async search: a superseded search is aborted, a stale result never shows", async () => {
    const signals: AbortSignal[] = [];
    const resolvers: ((v: MentionItem[]) => void)[] = [];
    const { ta } = await setup({
      debounceMs: 0,
      search: (q, { signal }) => {
        signals.push(signal);
        if (q !== "ab") return new Promise((r) => resolvers.push(r));
        return Promise.resolve([{ id: "b", label: "ab" }]);
      },
    });
    await typeTA(ta, "@");
    expect(document.querySelector(".atm-mention-status")!.textContent).toBe("Searching...");
    expect(document.querySelector(".atm-mention-list")!.getAttribute("aria-busy")).toBe("true");
    await typeTA(ta, "ab");
    await wait(10);
    expect(signals.slice(0, -1).every((s) => s.aborted)).toBe(true);
    for (const r of resolvers) r([{ id: "x", label: "stale" }]);
    await wait(10);
    expect(options().map((o) => o.textContent)).toEqual(["Aab"]);
  });

  it("a click outside or blur closes; destroy removes the menu and listeners", async () => {
    const { m, ta } = await setup();
    await typeTA(ta, "@ja");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menus().length).toBe(0);
    await typeTA(ta, "n");
    expect(menus().length).toBe(1);
    m.destroy();
    open.length = 0;
    expect(menus().length).toBe(0);
    expect(document.querySelectorAll(".atm-mention-live").length).toBe(0);
  });

  it("follows mode switches and does nothing without mentions", async () => {
    const { m } = await setup();
    m.ed.setMode("wysiwyg");
    m.ed.setMode("markdown");
    await wait(30);
    const ta = m.ed.element.querySelector("textarea")!;
    ta.focus();
    await typeTA(ta, "@b");
    await wait(150);
    expect(options().length).toBe(1);
    const r2 = await mountMd({ plugins: [createMarkdownMentionsPlugin()] });
    open.push(r2.m);
    await typeTA(r2.ta, " @x");
    // focus moved to the second editor (which has no mentions): the first one's menu closed
    expect(menus().length).toBe(0);
  });

  it("does not open for an email address or inside a word", async () => {
    const { ta } = await setup();
    await typeTA(ta, "mail a@ja");
    expect(menus().length).toBe(0);
  });
});
