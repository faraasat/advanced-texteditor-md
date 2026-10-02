import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createChannelTrigger, createCommandTrigger, createTagTrigger } from "../../../src/extensions/chips/presets";
import { createMarkdownMentionsPlugin } from "../../../src/extensions/chips/md-mentions";
import { caretAtEnd, mount, pressKey, typeInto, wait, type Mounted } from "../../plugins/helpers";
import { renderHtml } from "../../../src/render";
import { cleanupBody, key, menus, mountMd, options, typeTA, preload } from "./md-helpers";
import type { MentionItem } from "../../../src/types";

const sig = { signal: new AbortController().signal };
const open: Mounted[] = [];
beforeAll(preload);
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  cleanupBody();
});
const keep = (m: Mounted) => (open.push(m), m);

describe("createTagTrigger", () => {
  const tags = createTagTrigger({ tags: ["design", "Bug", "build"] });
  it("returns mentions + chips + a plugin, with the # trigger and the tag scheme", () => {
    expect(tags.mentions.trigger).toBe("#");
    expect(tags.mentions.scheme).toBe("tag");
    expect(tags.mentions.allowSpaces).toBe(false);
    expect(tags.chips).toEqual([{ scheme: "tag" }]);
    expect(tags.plugin?.name).toBe("tag-trigger");
  });
  it("searches the list and offers a Create row for a new valid tag", () => {
    const r = tags.mentions.search("bu", sig) as MentionItem[];
    expect(r.map((i) => i.label)).toEqual(["Bug", "build", "bu"]);
    expect(r[2]).toMatchObject({ id: "bu", description: "Create #bu", data: { create: true } });
    expect((tags.mentions.search("bug", sig) as MentionItem[]).map((i) => i.label)).toEqual(["Bug"]);
    expect((tags.mentions.search("12", sig) as MentionItem[]).length).toBe(0); // needs a letter
    expect((tags.mentions.search("a b", sig) as MentionItem[]).length).toBe(0);
    const noCreate = createTagTrigger({ tags: ["x"], allowCreate: false });
    expect((noCreate.mentions.search("new", sig) as MentionItem[]).length).toBe(0);
  });
  it("an async search gets the Create row too", async () => {
    const t = createTagTrigger({ search: async () => [{ id: "a", label: "alpha" }] });
    expect((await t.mentions.search("zed", sig)).map((i) => i.label)).toEqual(["alpha", "zed"]);
  });
  it("renders with the scheme the preset declares", () => {
    expect(renderHtml("[#design](tag:design)", { chips: tags.chips })).toContain('data-scheme="tag"');
  });

  it("WYSIWYG: #newtag then a space becomes a tag chip (one undo step)", async () => {
    const m = keep(mount({ value: "Note", mentions: [tags.mentions], chips: tags.chips, plugins: [tags.plugin!] }));
    caretAtEnd(m);
    await typeInto(m.surface, " #fresh ");
    expect(m.ed.getValue().trim()).toBe("Note [#fresh](tag:fresh)");
    m.ed.undo();
    expect(m.ed.getValue().trim()).toBe("Note #fresh");
  });
  it("WYSIWYG: Enter on the Create row makes the chip", async () => {
    const m = keep(mount({ value: "x", mentions: [tags.mentions], chips: tags.chips, plugins: [tags.plugin!] }));
    caretAtEnd(m);
    await typeInto(m.surface, " #zap");
    await wait(120);
    expect(options().map((o) => o.textContent)).toContain("ZzapCreate #zap");
    pressKey(m.surface, "Enter");
    await wait(10);
    expect(m.ed.getValue().trim()).toBe("x [#zap](tag:zap)");
  });
  it("a # in a heading or inside a word is left alone", async () => {
    const m = keep(mount({ value: "x", mentions: [tags.mentions], chips: tags.chips, plugins: [tags.plugin!] }));
    caretAtEnd(m);
    await typeInto(m.surface, " a#b c");
    expect(m.ed.getValue().trim()).toBe("x a#b c");
  });
  it("Markdown pane: #newtag + space writes the wire text", async () => {
    const { m, ta } = await mountMd({ mentions: [tags.mentions], chips: tags.chips, plugins: [tags.plugin!, createMarkdownMentionsPlugin()] });
    keep(m);
    await typeTA(ta, "see #todo ");
    expect(m.ed.getValue()).toBe("see [#todo](tag:todo) ");
    m.ed.undo();
    expect(m.ed.getValue()).toBe("see #todo ");
  });
  it("composition text never creates a tag", async () => {
    const m = keep(mount({ value: "x", mentions: [tags.mentions], plugins: [tags.plugin!] }));
    tags.plugin!.afterInput!(m.ed, { inputType: "insertCompositionText", data: " " });
    expect(m.ed.getValue().trim()).toBe("x");
  });
});

describe("createChannelTrigger", () => {
  it("defaults to ~ and the channel scheme; searches the list", () => {
    const c = createChannelTrigger({ channels: [{ id: "c1", label: "general" }, { id: "c2", label: "random" }] });
    expect(c.mentions.trigger).toBe("~");
    expect(c.mentions.scheme).toBe("channel");
    expect((c.mentions.search("ran", sig) as MentionItem[]).map((i) => i.id)).toEqual(["c2"]);
    expect(createChannelTrigger({ trigger: "#" }).mentions.trigger).toBe("#");
  });
  it("picking in the editor inserts a channel chip", async () => {
    const c = createChannelTrigger({ channels: [{ id: "c1", label: "general" }] });
    const m = keep(mount({ value: "x", mentions: [c.mentions], chips: c.chips }));
    caretAtEnd(m);
    await typeInto(m.surface, " ~gen");
    await wait(150);
    pressKey(m.surface, "Enter");
    await wait(10);
    // stringify escapes the tilde (it is strikethrough syntax); it still parses back as the trigger
    expect(m.ed.getValue().trim()).toBe("x [\\~general](channel:c1)");
    expect(m.ed.getMentions()[0]).toMatchObject({ trigger: "~", label: "general", scheme: "channel" });
  });
});

describe("createCommandTrigger", () => {
  const run = vi.fn((ed) => ed.insertText("DONE"));
  const cmds = createCommandTrigger({ commands: [{ id: "date", label: "Insert date", keywords: ["today"], run }, { id: "sig", label: "Signature", run: (ed) => ed.insertText("-- me") }] });

  it("feeds the slash menu and never uses / as its trigger", () => {
    expect(cmds.plugin.slash?.map((s) => s.id)).toEqual(["command:date", "command:sig"]);
    const c2 = createCommandTrigger({ commands: [{ id: "a", label: "A", run: () => {} }], trigger: "/" });
    expect(c2.plugin.name).toBe("command-trigger");
    expect(createCommandTrigger({ commands: [], slash: false }).plugin.slash).toBeUndefined();
  });

  it("WYSIWYG: >query + Enter removes the text and runs the command, as one undo step", async () => {
    run.mockClear();
    const m = keep(mount({ value: "Hi", plugins: [cmds.plugin] }));
    await wait(30);
    caretAtEnd(m);
    await typeInto(m.surface, " >tod");
    expect(options().map((o) => o.textContent)).toEqual(["IDInsert date"]);
    pressKey(m.surface, "Enter");
    await wait(10);
    expect(run).toHaveBeenCalledTimes(1);
    expect(m.ed.getValue().trim()).toBe("Hi DONE");
    m.ed.undo();
    expect(m.ed.getValue().trim()).toBe("Hi >tod");
  });

  it("Markdown pane: the same, in the textarea", async () => {
    const { m, ta } = await mountMd({ plugins: [cmds.plugin] });
    keep(m);
    await wait(30);
    await typeTA(ta, "x >sig");
    expect(options().length).toBe(1);
    key(ta, "Enter");
    expect(m.ed.getValue()).toBe("x -- me");
    m.ed.undo();
    expect(m.ed.getValue()).toBe("x >sig");
  });

  it("a lone > or an unknown name shows nothing; a throwing command is contained", async () => {
    const bad = createCommandTrigger({ commands: [{ id: "boom", label: "Boom", run: () => { throw new Error("x"); } }] });
    const m = keep(mount({ value: "", plugins: [bad.plugin] }));
    await wait(30);
    caretAtEnd(m);
    await typeInto(m.surface, ">");
    expect(menus().length).toBe(0);
    await typeInto(m.surface, "zz");
    expect(menus().length).toBe(0);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    m.ed.setValue("");
    caretAtEnd(m);
    await typeInto(m.surface, ">bo");
    pressKey(m.surface, "Enter");
    await wait(10);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    expect(m.ed.getValue().trim()).toBe("");
  });
});
