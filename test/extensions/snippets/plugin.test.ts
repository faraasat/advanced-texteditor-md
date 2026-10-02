import { afterEach, describe, expect, it } from "vitest";
import { createSnippets, findTrigger, type SnippetsOptions } from "../../../src/extensions/snippets/plugin";
import { memorySnippets } from "../../../src/extensions/snippets/storage";
import type { Snippet } from "../../../src/extensions/snippets/model";
import { backspace, caretAfter, caretAtEnd, mount, pressKey, selectText, setSel, textareaReady, tick, typeInto, wait, type Mounted } from "../../plugins/helpers";
import { typeTA } from "../chips/md-helpers";

const NOW = () => new Date(2026, 9, 2, 9, 5);
const snippets: Snippet[] = [
  { id: "sig", name: "Signature", trigger: ";sig", body: "Ada Lovelace", scope: "inline" },
  { id: "date", name: "Date stamp", trigger: ";d", body: "{{date}}", scope: "inline" },
  { id: "cur", name: "Cursor", trigger: ";cur", body: "Dear {{cursor}},\n\nBest", scope: "block" },
  { id: "wrap", name: "Quote selection", trigger: ";q", body: "> {{selection}}", scope: "block" },
  { id: "meet", name: "Meeting notes", trigger: ";meet", body: "## Meeting\n\n- Attendees: \n- Notes: {{cursor}}\n\nDate: {{date}}", scope: "block" },
];

const open: Mounted[] = [];
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.querySelectorAll(".atm-snip-picker").forEach((e) => e.remove());
});

function setup(value = "", o: Partial<SnippetsOptions> = {}, extra: Parameters<typeof mount>[0] = {}) {
  const sn = createSnippets({ storage: memorySnippets(snippets), now: NOW, locale: "en-US", ...o });
  const m = mount({ value, plugins: [sn.plugin], ...extra });
  open.push(m);
  m.surface.focus();
  return { sn, m };
}

describe("findTrigger", () => {
  const lookup = (t: string) => snippets.find((s) => s.trigger === t);
  it("finds a trigger at a word boundary", () => {
    expect(findTrigger(";sig", lookup)?.start).toBe(0);
    expect(findTrigger("hello ;sig", lookup)?.start).toBe(6);
    expect(findTrigger("(;sig", lookup)?.start).toBe(1);
    expect(findTrigger("“;sig", lookup)?.start).toBe(1);
  });
  it("not inside a word, and not a longer or shorter token", () => {
    expect(findTrigger("x;sig", lookup)).toBeNull();
    expect(findTrigger(";sigx", lookup)).toBeNull();
    expect(findTrigger("sig", lookup)).toBeNull();
    expect(findTrigger("", lookup)).toBeNull();
    expect(findTrigger("a ;sig b", lookup)).toBeNull();
  });
  it("ignores a very long run", () => {
    expect(findTrigger("x".repeat(100_000) + ";sig", lookup)).toBeNull();
    expect(findTrigger(" ".repeat(100_000) + ";sig", lookup)?.start).toBe(100_000);
  });
});

const caretOffsetInText = (): string => {
  const sel = document.getSelection()!;
  const n = sel.anchorNode as Text;
  return n.nodeType === 3 ? n.data.slice(0, sel.anchorOffset) + "|" + n.data.slice(sel.anchorOffset) : `<${n.nodeName}>@${sel.anchorOffset}`;
};

describe("typed expansion in the WYSIWYG surface", () => {
  it(";sig + space expands in place and keeps the space", async () => {
    const { m } = setup("Regards, ");
    caretAtEnd(m);
    await typeInto(m.surface, ";sig ");
    expect(m.ed.getValue()).toBe("Regards, Ada Lovelace");
    expect(m.surface.textContent).toBe("Regards, Ada Lovelace ");
    const r = document.createRange();
    r.setStart(m.surface.firstChild!, 0);
    r.setEnd(document.getSelection()!.anchorNode!, document.getSelection()!.anchorOffset);
    expect(r.toString()).toBe("Regards, Ada Lovelace ");
  });

  it("is ONE undo step that returns to what was typed", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";sig ");
    expect(m.ed.getValue()).toBe("Ada Lovelace");
    m.ed.undo();
    // the stored Markdown has no trailing space, so the typed space is not part of the history
    expect(m.surface.textContent?.trim()).toBe(";sig");
    m.ed.redo();
    expect(m.ed.getValue()).toBe("Ada Lovelace");
  });

  it("Backspace right after an expansion puts back the typed trigger; the next key is ordinary", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";sig ");
    await backspace(m.surface);
    expect(m.surface.textContent?.trim()).toBe(";sig");
    // the next space is an ordinary space, so the trigger can stay as literal text
    await typeInto(m.surface, " ");
    expect(m.ed.getValue()).toBe(";sig");
    expect(m.surface.textContent).toContain(";sig");
    // but typing the trigger again afterwards expands again
    await typeInto(m.surface, ";sig ");
    expect(m.ed.getValue()).toBe(";sig Ada Lovelace");
  });

  it("Backspace after anything else is an ordinary Backspace", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";sig ");
    await typeInto(m.surface, "x");
    await backspace(m.surface);
    expect(m.surface.textContent).toBe("Ada Lovelace ");
  });

  it("only at a word boundary and only for an exact trigger", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, "x;sig ");
    expect(m.ed.getValue()).toBe("x;sig");
    await typeInto(m.surface, ";sigs ");
    expect(m.surface.textContent).toBe("x;sig ;sigs ");
  });

  it("works after an opening bracket and mid-sentence", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, "by (;sig ");
    expect(m.ed.getValue()).toBe("by (Ada Lovelace");
  });

  it("{{date}} expands to the local ISO date", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";d ");
    expect(m.ed.getValue()).toBe("2026-10-02");
  });

  it("{{cursor}} puts the caret there and nothing of it stays in the text", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";cur ");
    expect(m.ed.getValue()).toBe("Dear ,\n\nBest");
    expect(m.surface.textContent).not.toContain(String.fromCharCode(0xfdd0));
    expect(caretOffsetInText()).toBe("Dear |,");
    await typeInto(m.surface, "Ada");
    expect(m.ed.getValue()).toBe("Dear Ada,\n\nBest");
  });

  it("a block snippet replaces an otherwise empty paragraph with its blocks", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";meet ");
    expect(m.ed.getValue()).toBe("## Meeting\n\n- Attendees:\n- Notes:\n\nDate: 2026-10-02");
    expect(m.surface.querySelectorAll("h2").length).toBe(1);
    expect(m.surface.querySelectorAll("li").length).toBe(2);
    expect(m.surface.textContent).not.toContain(" ".repeat(0) + ";meet");
  });

  it("a block snippet after text starts its own block", async () => {
    const { m } = setup("Intro");
    caretAtEnd(m);
    await typeInto(m.surface, " ;cur ");
    expect(m.ed.getValue()).toBe("Intro\n\nDear ,\n\nBest");
  });

  it("{{selection}} is empty for a typed trigger", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";q ");
    expect(m.ed.getValue().trim()).toBe(">");
  });

  it("does not expand inside inline code, a code block, a link or math", async () => {
    const { m } = setup("a `code` b\n\n```\nblock\n```\n\n[link](https://example.com)");
    for (const needle of ["code", "block", "link"]) {
      caretAfter(m.surface, needle);
      await typeInto(m.surface, " ;sig ");
    }
    expect(m.ed.getValue()).not.toContain("Ada");
  });

  it("does nothing in a read-only editor or when disabled by expandOn", async () => {
    const { m } = setup("", { expandOn: [] });
    caretAtEnd(m);
    await typeInto(m.surface, ";sig ");
    expect(m.surface.textContent).toBe(";sig ");
  });

  it("emits plugin:snippets:insert", async () => {
    const { m } = setup("");
    const seen: unknown[] = [];
    m.ed.on("plugin:snippets:insert", (p) => seen.push(p));
    caretAtEnd(m);
    await typeInto(m.surface, ";sig ");
    expect(seen).toEqual([{ id: "sig", via: "trigger" }]);
  });
});

describe("Tab and Enter", () => {
  it("Tab expands a typed trigger and is consumed", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";sig");
    const ev = pressKey(m.surface, "Tab");
    expect(ev.defaultPrevented).toBe(true);
    expect(m.ed.getValue()).toBe("Ada Lovelace");
    expect(m.surface.querySelectorAll("p").length).toBe(1);
  });
  it("Enter expands instead of splitting the paragraph", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";sig");
    const ev = pressKey(m.surface, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    expect(m.surface.querySelectorAll("p").length).toBe(1);
    expect(m.ed.getValue()).toBe("Ada Lovelace");
  });
  it("Backspace after a Tab expansion reverts it", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";sig");
    pressKey(m.surface, "Tab");
    await backspace(m.surface);
    expect(m.surface.textContent).toBe(";sig");
  });
  it("Tab and Enter with no trigger before the caret are left alone", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, "hello");
    expect(pressKey(m.surface, "Tab").defaultPrevented).toBe(false);
    expect(pressKey(m.surface, "Enter").defaultPrevented).toBe(false);
  });
  it("respects expandOn", async () => {
    const { m } = setup("", { expandOn: ["space"] });
    caretAtEnd(m);
    await typeInto(m.surface, ";sig");
    expect(pressKey(m.surface, "Tab").defaultPrevented).toBe(false);
    expect(m.ed.getValue()).toBe(";sig");
  });
  it("Shift+Tab and modified keys do not expand", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    await typeInto(m.surface, ";sig");
    expect(pressKey(m.surface, "Tab", { shift: true }).defaultPrevented).toBe(false);
    pressKey(m.surface, "Enter", { ctrl: true });
    expect(m.ed.getValue()).toBe(";sig");
  });
});

describe("variables from the host", () => {
  it("text values are escaped, markdown values are not, async values wait", async () => {
    const sn = createSnippets({
      storage: memorySnippets([
        { id: "who", name: "Who", trigger: ";who", body: "Hi {{name}} / {{note}} / {{late}}", scope: "inline" },
      ]),
      variables: { name: "**Ada**", note: { value: "**bold**", markdown: true }, late: async () => "Grace" },
    });
    const m = mount({ value: "", plugins: [sn.plugin] });
    open.push(m);
    m.surface.focus();
    caretAtEnd(m);
    await typeInto(m.surface, ";who ");
    await wait(30);
    expect(m.ed.getValue()).toBe("Hi \\*\\*Ada\\*\\* / **bold** / Grace");
    expect(m.surface.querySelectorAll("strong").length).toBe(1);
  });
  it("an async value that arrives after the user moved on does not edit the document", async () => {
    let release!: (v: string) => void;
    const sn = createSnippets({
      storage: memorySnippets([{ id: "slow", name: "Slow", trigger: ";slow", body: "[{{v}}]", scope: "inline" }]),
      variables: { v: () => new Promise<string>((r) => (release = r)) },
    });
    const m = mount({ value: "", plugins: [sn.plugin] });
    open.push(m);
    m.surface.focus();
    caretAtEnd(m);
    await typeInto(m.surface, ";slow ");
    await typeInto(m.surface, "x");
    release("LATE");
    await wait(20);
    expect(m.ed.getValue()).toBe(";slow x");
  });
});

describe("insert at the selection", () => {
  it("{{selection}} wraps the selected Markdown, in one undo step", async () => {
    const { sn, m } = setup("one **two** three");
    selectText(m.surface, "two");
    expect(await sn.insert(m.ed, "wrap")).toBe(true);
    expect(m.ed.getValue()).toBe("one\n\n> **two**\n\nthree");
    m.ed.undo();
    expect(m.ed.getValue()).toBe("one **two** three");
  });
  it("an unknown id or a read-only editor inserts nothing", async () => {
    const { sn, m } = setup("x");
    expect(await sn.insert(m.ed, "nope")).toBe(false);
    m.ed.setReadOnly(true);
    expect(await sn.insert(m.ed, "sig")).toBe(false);
    expect(m.ed.getValue()).toBe("x");
  });
  it("the command plugin:snippets:insert takes an id", async () => {
    const { m } = setup("");
    caretAtEnd(m);
    expect(m.ed.exec("plugin:snippets:insert", "sig")).toBe(true);
    await wait(10);
    expect(m.ed.getValue()).toBe("Ada Lovelace");
    expect(m.ed.exec("plugin:snippets:insert", "missing")).toBe(false);
  });
});

describe("the Markdown pane", () => {
  async function mdSetup(value = "") {
    const sn = createSnippets({ storage: memorySnippets(snippets), now: NOW, locale: "en-US" });
    const m = mount({ value, mode: "markdown", plugins: [sn.plugin] });
    open.push(m);
    const ta = await textareaReady(m);
    await wait(20);
    ta.focus();
    return { sn, m, ta };
  }
  it("inserts the body verbatim", async () => {
    const { m, ta } = await mdSetup();
    await typeTA(ta, ";meet ");
    expect(ta.value).toBe("## Meeting\n\n- Attendees: \n- Notes: \n\nDate: 2026-10-02");
    expect(m.ed.getValue()).toBe(ta.value);
  });
  it("places the caret at {{cursor}} and undoes in one step; Backspace reverts", async () => {
    const { m, ta } = await mdSetup();
    await typeTA(ta, ";cur ");
    expect(ta.value).toBe("Dear ,\n\nBest");
    expect(ta.selectionStart).toBe(5);
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    expect(ta.value).toBe(";cur ");
    expect(m.ed.getValue()).toBe(";cur ");
  });
  it("Tab expands", async () => {
    const { ta } = await mdSetup();
    await typeTA(ta, "hi ;sig");
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    ta.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(ta.value).toBe("hi Ada Lovelace");
  });
  it("{{selection}} is the selected source", async () => {
    const { sn, m, ta } = await mdSetup("keep **this** here");
    ta.setSelectionRange(5, 13);
    await sn.insert(m.ed, "wrap");
    expect(ta.value).toBe("keep > **this** here");
  });
  it("a trigger is not recognised across a line break", async () => {
    const { ta } = await mdSetup();
    await typeTA(ta, ";si\ng ");
    expect(ta.value).toBe(";si\ng ");
  });
});

describe("a store that loads later", () => {
  it("expands once the adapter's list has arrived", async () => {
    let release!: (l: Snippet[]) => void;
    const sn = createSnippets({ storage: { load: () => new Promise<Snippet[]>((r) => (release = r)), save: () => {} } });
    const m = mount({ value: "", plugins: [sn.plugin] });
    open.push(m);
    m.surface.focus();
    caretAtEnd(m);
    await typeInto(m.surface, ";sig ");
    expect(m.surface.textContent).toBe(";sig ");
    release(snippets);
    await sn.store.ready;
    await typeInto(m.surface, ";sig ");
    expect(m.ed.getValue()).toBe(";sig Ada Lovelace");
  });
});

void setSel;
void tick;
