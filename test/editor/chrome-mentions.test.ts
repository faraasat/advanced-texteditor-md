import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, tick } from "./fakes";
import type { MentionItem, MentionOptions } from "../../src/types";

const cleanups: (() => void)[] = [];
const m = (o?: Parameters<typeof mount>[0]) => {
  const x = mount(o);
  cleanups.push(x.cleanup);
  return x;
};
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.querySelectorAll(".atm-mention-menu,.atm-mention-live").forEach((e) => e.remove());
});

const people: MentionItem[] = [
  { id: "u1", label: "Jane Doe", kind: "person", badge: "Team A", color: 3, refs: { clickup: "123", hub: "h9" } },
  { id: "u2", label: "Jan Kowalski", kind: "both" },
  { id: "u3", label: "Jade Smith", kind: "person", badge: "Team A", color: 1 },
];
const search: MentionOptions["search"] = async (q) => people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()));

function typeAt(x: ReturnType<typeof m>, text: string) {
  const ed = x.surface.editable;
  ed.textContent = "";
  const t = document.createTextNode(text);
  ed.appendChild(t);
  ed.focus();
  const r = document.createRange();
  r.setStart(t, text.length);
  r.collapse(true);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
  ed.dispatchEvent(new Event("input", { bubbles: true }));
}
const key = (el: HTMLElement, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("mentions: wiring", () => {
  it("typing the trigger opens the menu on the editable and picking inserts a chip with refs", async () => {
    const x = m({ mentions: { search } });
    typeAt(x, "hi @Jan");
    await tick(30);
    const opts = document.querySelectorAll('[role="option"]');
    expect(opts.length).toBe(2);
    // aria-expanded is not allowed on role=textbox (axe: critical), so it is stripped; the
    // listbox is still wired up with aria-controls / aria-activedescendant by the controller.
    expect(x.surface.editable.hasAttribute("aria-expanded")).toBe(false);
    expect(x.surface.editable.getAttribute("aria-controls")).toBeTruthy();
    key(x.surface.editable, "Enter");
    expect(x.surface.replaced).toHaveLength(1);
    expect(x.surface.replaced[0].chip).toEqual({
      scheme: "mention",
      kind: "person",
      id: "u1",
      label: "Jane Doe",
      trigger: "@",
      attrs: { clickup: "123", hub: "h9" },
    });
  });
  it("the range handed over covers the typed @query", async () => {
    const x = m({ mentions: { search } });
    typeAt(x, "hi @Jan");
    await tick(30);
    key(x.surface.editable, "Enter");
    expect(x.surface.replaced[0].range).toBeTruthy();
  });
  it("a chip without refs carries no attrs key", async () => {
    const x = m({ mentions: { search } });
    typeAt(x, "@Jade");
    await tick(30);
    key(x.surface.editable, "Enter");
    expect(x.surface.replaced[0].chip).toEqual({ scheme: "mention", kind: "person", id: "u3", label: "Jade Smith", trigger: "@" });
  });
  it("an item without a kind gives an empty kind", async () => {
    const x = m({ mentions: { search: async () => [{ id: "z", label: "Zed" }] } });
    typeAt(x, "@z");
    await tick(30);
    key(x.surface.editable, "Enter");
    expect((x.surface.replaced[0].chip as { kind: string }).kind).toBe("");
  });
  it("several triggers, schemes and option entries share one controller", async () => {
    const x = m({
      mentions: [
        { search, trigger: "@" },
        { search: async () => [{ id: "T-1", label: "Fix login", kind: "issue" }], trigger: "#", scheme: "task" },
      ],
    });
    typeAt(x, "see #fix");
    await tick(30);
    key(x.surface.editable, "Enter");
    expect(x.surface.replaced[0].chip).toMatchObject({ scheme: "task", kind: "issue", id: "T-1", trigger: "#" });
  });
  it("does not open inside an email address", async () => {
    const x = m({ mentions: { search } });
    typeAt(x, "mail me at a@Jane");
    await tick(30);
    expect(document.querySelectorAll('[role="option"]').length).toBe(0);
  });
  it("destroy removes the menu and restores the editable's aria attributes", async () => {
    const x = m({ mentions: { search } });
    typeAt(x, "@Jan");
    await tick(30);
    const ed = x.surface.editable;
    x.ed.destroy();
    expect(document.querySelectorAll('[role="option"]').length).toBe(0);
    expect(ed.hasAttribute("aria-expanded")).toBe(false);
  });
});

describe("mentions: chip colour and badge", () => {
  it("a searched item teaches its (scheme, kind) palette colour and badge", async () => {
    const x = m({ mentions: { search } });
    typeAt(x, "@J");
    await tick(30);
    const def = x.surface.options.render.chips!.mention;
    expect(def.kinds!.person).toEqual({ color: 3, label: "Team A" });
    expect(def.kinds!.both).toBeUndefined(); // no colour, no badge: nothing to learn
  });
  it("the render options object is shared, so a later chip picks the colour up", async () => {
    const x = m({ mentions: { search } });
    const before = x.surface.options.render;
    typeAt(x, "@Jane");
    await tick(30);
    expect(x.surface.options.render).toBe(before);
    expect(before.chips!.mention.kinds!.person.color).toBe(3);
  });
  it("host-declared kinds are never overwritten", async () => {
    const x = m({
      mentions: { search },
      chips: [{ scheme: "mention", kinds: { person: { color: 7, label: "Hub" } } }],
    });
    typeAt(x, "@J");
    await tick(30);
    expect(x.surface.options.render.chips!.mention.kinds!.person).toEqual({ color: 7, label: "Hub" });
  });
  it("a CSS colour string is kept as written", async () => {
    const x = m({ mentions: { search: async () => [{ id: "a", label: "Ann", kind: "vip", color: "#aa00cc" }] } });
    typeAt(x, "@a");
    await tick(30);
    expect(x.surface.options.render.chips!.mention.kinds!.vip.color).toBe("#aa00cc");
  });
  it("items with a colour but no kind style the empty kind", async () => {
    const x = m({ mentions: { search: async () => [{ id: "a", label: "Ann", color: 2 }] } });
    typeAt(x, "@a");
    await tick(30);
    expect(x.surface.options.render.chips!.mention.kinds![""]).toEqual({ color: 2, label: undefined });
  });
  it("a synchronous search function works too", async () => {
    const x = m({ mentions: { search: () => people } });
    typeAt(x, "@");
    await tick(30);
    expect(x.surface.options.render.chips!.mention.kinds!.person.color).toBe(3);
  });
  it("the rendered chip really carries the colour (render + options)", async () => {
    const { renderHtml } = await import("../../src/render");
    const x = m({ mentions: { search } });
    typeAt(x, "@Jane");
    await tick(30);
    const html = renderHtml("[@Jane Doe](mention:person/u1)", x.surface.options.render);
    expect(html).toContain("--atm-chip-color:var(--atm-chip-3)");
    expect(html).toContain("Team A");
    const both = renderHtml("[@Jan](mention:both/u2)", x.surface.options.render);
    expect(both).not.toContain("atm-chip-badge");
  });
});

describe("mentions: change notifications", () => {
  const chipMd = (id: string, kind = "person") => `[@N${id}](mention:${kind}/${id})`;
  it("fires when the set of chips changes, not on every edit", () => {
    const seen: string[][] = [];
    const ev: number[] = [];
    const x = m({ onMentionsChange: (l) => seen.push(l.map((c) => c.id)) });
    x.ed.on("mentions", (l) => ev.push(l.length));
    x.surface.simulateInput("hello");
    expect(seen).toEqual([]);
    x.surface.simulateInput(`hello ${chipMd("1")}`);
    expect(seen).toEqual([["1"]]);
    x.surface.simulateInput(`hello there ${chipMd("1")}`); // text edit, same chips
    expect(seen).toEqual([["1"]]);
    x.surface.simulateInput(`${chipMd("1")} ${chipMd("2")}`);
    expect(seen).toEqual([["1"], ["1", "2"]]);
    x.surface.simulateInput(`${chipMd("1")} ${chipMd("1")}`); // duplicates collapse
    expect(seen.at(-1)).toEqual(["1"]);
    x.surface.simulateInput("none");
    expect(seen.at(-1)).toEqual([]);
    expect(ev).toEqual([1, 2, 1, 0]);
  });
  it("the same id under a different kind is a different mention", () => {
    const seen: number[] = [];
    const x = m({ onMentionsChange: (l) => seen.push(l.length) });
    x.surface.simulateInput(chipMd("1", "person"));
    x.surface.simulateInput(`${chipMd("1", "person")} ${chipMd("1", "team")}`);
    expect(seen).toEqual([1, 2]);
  });
  it("getMentions walks the document and ignores non-mention chip schemes", () => {
    const x = m({ value: "[@A](mention:person/1) [T](task:issue/9) [@B](mention:2) [@A](mention:person/1)", chips: [{ scheme: "task" }] });
    expect(x.ed.getMentions().map((c) => `${c.scheme}:${c.kind}:${c.id}`)).toEqual(["mention:person:1", "mention::2"]);
  });
  it("a custom mention scheme counts as a mention", () => {
    const x = m({ value: "[#T](task:issue/9)", mentions: { search, scheme: "task", trigger: "#" } });
    expect(x.ed.getMentions()).toHaveLength(1);
  });
  it("setValue updates the baseline silently", () => {
    const seen: number[] = [];
    const x = m({ onMentionsChange: (l) => seen.push(l.length) });
    x.ed.setValue(chipMd("1"));
    x.surface.simulateInput(chipMd("1") + " more");
    expect(seen).toEqual([]);
  });
  it("the chips keep their attrs (the refs)", () => {
    const x = m({ value: "[@Jane](mention:person/u1?clickup=123&hub=h9)" });
    expect(x.ed.getMentions()[0].attrs).toEqual({ clickup: "123", hub: "h9" });
  });
  it("hands the list over to the event too", () => {
    const x = m();
    const got: unknown[] = [];
    x.ed.on("mentions", (l) => got.push(l));
    x.surface.simulateInput(chipMd("5"));
    expect(got).toHaveLength(1);
    void vi;
  });
});
