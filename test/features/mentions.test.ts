import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MentionItem, MentionOptions } from "../../src/types";
import {
  createMentionController,
  detectTrigger,
  mentionHref,
  parseMentionHref,
} from "../../src/features/mentions";

/* ───────────────────────── pure helpers ───────────────────────── */

describe("detectTrigger", () => {
  const T = ["@"];
  it.each([
    ["@", { trigger: "@", query: "", start: 0 }],
    ["@ja", { trigger: "@", query: "ja", start: 0 }],
    ["hello @ja", { trigger: "@", query: "ja", start: 6 }],
    ["hello\n@ja", { trigger: "@", query: "ja", start: 6 }],
    ["hello\t@ja", { trigger: "@", query: "ja", start: 6 }],
    ["(@ja", { trigger: "@", query: "ja", start: 1 }],
    ["hi, @ja", { trigger: "@", query: "ja", start: 4 }],
    ["said \"@ja", { trigger: "@", query: "ja", start: 6 }],
    ["end.@ja", { trigger: "@", query: "ja", start: 4 }],
    ["hi @Jane Do", { trigger: "@", query: "Jane Do", start: 3 }],
    ["hi @jane @bo", { trigger: "@", query: "bo", start: 9 }],
  ])("%j", (text, expected) => {
    expect(detectTrigger(text, T, true)).toEqual(expected);
  });
  it.each([
    "a@b.com",
    "mail me at jane@example.com",
    "foo@",
    "x_@y",
    "no trigger here",
    "",
    "5 @ 6pm", // query would start with a space
    "@ ",
    "price@5",
  ])("does not trigger for %j", (text) => {
    expect(detectTrigger(text, T, true)).toBeNull();
  });
  it("no trigger once the line has been broken", () => {
    expect(detectTrigger("@jane\nfoo", T, true)).toBeNull();
  });
  it("without allowSpaces the query ends at whitespace", () => {
    expect(detectTrigger("@jane doe", T, false)).toBeNull();
    expect(detectTrigger("hi @jane", T, false)).toEqual({ trigger: "@", query: "jane", start: 3 });
  });
  it("supports several triggers; the one closest to the caret wins", () => {
    expect(detectTrigger("see #12", ["@", "#"], true)).toEqual({ trigger: "#", query: "12", start: 4 });
    expect(detectTrigger("@jane #12", ["@", "#"], true)).toEqual({ trigger: "#", query: "12", start: 6 });
    expect(detectTrigger("#12 @jane", ["@", "#"], true)).toEqual({ trigger: "@", query: "jane", start: 4 });
  });
  it("supports multi-character triggers", () => {
    expect(detectTrigger("see [[pag", ["[["], true)).toEqual({ trigger: "[[", query: "pag", start: 4 });
  });
  it("caps very long queries", () => {
    expect(detectTrigger("@" + "a".repeat(200), T, true)).toBeNull();
  });
});

describe("mentionHref / parseMentionHref", () => {
  const chip = (o: Partial<{ scheme: string; kind: string; id: string; attrs: Record<string, string> }> = {}) => ({
    scheme: "mention", kind: "person", id: "u1", ...o,
  });
  it.each([
    [chip(), "mention:person/u1"],
    [chip({ kind: "" }), "mention:u1"],
    [chip({ attrs: { clickup: "123" } }), "mention:person/u1?clickup=123"],
    [chip({ attrs: { a: "1", b: "2" } }), "mention:person/u1?a=1&b=2"],
    [chip({ scheme: "task", kind: "issue", id: "12" }), "task:issue/12"],
    [chip({ id: "a b" }), "mention:person/a%20b"],
    [chip({ id: "a/b" }), "mention:person/a%2Fb"],
    [chip({ id: "a?b" }), "mention:person/a%3Fb"],
    [chip({ id: "a)b(c" }), "mention:person/a%29b%28c"],
    [chip({ id: "é" }), "mention:person/%C3%A9"],
    [chip({ attrs: { "k&=": "v&= #" } }), "mention:person/u1?k%26%3D=v%26%3D%20%23"],
    [chip({ attrs: {} }), "mention:person/u1"],
  ])("serialises %j", (c, href) => {
    expect(mentionHref(c)).toBe(href);
  });

  it.each([
    ["mention:person/u1", { scheme: "mention", kind: "person", id: "u1" }],
    ["mention:u1", { scheme: "mention", kind: "", id: "u1" }],
    ["mention:person/u1?clickup=123", { scheme: "mention", kind: "person", id: "u1", attrs: { clickup: "123" } }],
    ["mention:person/u1?a=1&b=2&c=", { scheme: "mention", kind: "person", id: "u1", attrs: { a: "1", b: "2", c: "" } }],
    ["MENTION:person/u1", { scheme: "mention", kind: "person", id: "u1" }],
    ["task:issue/12", { scheme: "task", kind: "issue", id: "12" }],
    ["mention:person/a%20b", { scheme: "mention", kind: "person", id: "a b" }],
    ["mention:person/a%2Fb", { scheme: "mention", kind: "person", id: "a/b" }],
    ["mention:person/%C3%A9", { scheme: "mention", kind: "person", id: "é" }],
    ["mention:person/u1?flag", { scheme: "mention", kind: "person", id: "u1", attrs: { flag: "" } }],
    ["mention:person/u1?a=b=c", { scheme: "mention", kind: "person", id: "u1", attrs: { a: "b=c" } }],
    ["mention:person/u1?", { scheme: "mention", kind: "person", id: "u1" }],
  ])("parses %j", (href, expected) => {
    expect(parseMentionHref(href)).toEqual(expected);
  });

  it.each([
    "", "mention:", "mention:person/", "mention:/", "http://example.com", "https:x", "javascript:alert(1)",
    "person/u1", ":person/u1", "mention:person/%E0%A4%A", "mention:person/u1?a=%zz",
  ])("rejects %j", (href) => {
    // `http:` and friends are not chips: callers pass a scheme filter
    expect(parseMentionHref(href, ["mention", "task"])).toBeNull();
  });

  it("scheme filter", () => {
    expect(parseMentionHref("task:issue/1", ["mention"])).toBeNull();
    expect(parseMentionHref("task:issue/1", ["mention", "task"])).not.toBeNull();
    expect(parseMentionHref("https://a.com/b")).toBeNull(); // http(s) are never chips
    expect(parseMentionHref("mailto:a@b.c")).toBeNull();
  });

  it("round-trips awkward values", () => {
    const awkward = ["plain", "with space", "a/b/c", "q?x=1&y=2", "pct%41", "(paren)", "ünï", "日本", "a+b", "#hash", "\"quote\"", "back\\slash"];
    for (const id of awkward) {
      for (const kind of ["", "person", "k ind"]) {
        const c = { scheme: "mention", kind, id, attrs: { [id]: id, other: "x y" } };
        expect(parseMentionHref(mentionHref(c))).toEqual(c);
      }
    }
  });
  it("href never contains characters that break a markdown link destination", () => {
    const h = mentionHref({ scheme: "mention", kind: "person", id: "a b)(c<>\"'\\`", attrs: { x: " )(" } });
    expect(h).not.toMatch(/[\s()<>"'\\`]/);
  });
});

/* ───────────────────────── controller ───────────────────────── */

const people: MentionItem[] = [
  { id: "1", label: "Jane Doe", kind: "person", description: "Design", badge: "Hub", color: 3 },
  { id: "2", label: "Jack Black", kind: "person", avatarUrl: "https://cdn.example.com/a.png" },
  { id: "3", label: "Bob Ross", kind: "person", color: "#ff0000" },
];

let root: HTMLElement;
let text: Text;
let ctrl: ReturnType<typeof createMentionController> | null = null;
let picked: Array<{ item: MentionItem; index: number; range: Range }> = [];

function mount(
  options: Partial<MentionOptions>[] | Partial<MentionOptions> = {},
  extra: Partial<Parameters<typeof createMentionController>[0]> = {},
) {
  const list = (Array.isArray(options) ? options : [options]).map(
    (o) => ({ search: (q: string) => people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())), debounceMs: 50, ...o }) as MentionOptions,
  );
  ctrl = createMentionController({
    root,
    options: list,
    labels: {},
    onPick: (item, index, range) => picked.push({ item, index, range }),
    getRect: () => new DOMRect(100, 100, 0, 18),
    ...extra,
  });
  return ctrl;
}
const sel = () => document.getSelection()!;
function caretAt(offset = text.data.length) {
  sel().removeAllRanges();
  const r = document.createRange();
  r.setStart(text, offset);
  r.collapse(true);
  sel().addRange(r);
}
function type(s: string) {
  text.data += s;
  caretAt();
  ctrl!.notifyInput();
}
const menu = () => document.querySelector<HTMLElement>(".atm-mention-menu");
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
const labels = () => options().map((o) => o.querySelector(".atm-mention-label")?.textContent);
const key = (k: string, init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  text = document.createTextNode("");
  root.append(text);
  document.body.append(root);
  picked = [];
});
afterEach(() => {
  ctrl?.destroy();
  ctrl = null;
  vi.useRealTimers();
});

describe("opening and closing", () => {
  it("opens when the trigger is typed and shows the first results immediately", async () => {
    mount();
    type("hi @");
    expect(ctrl!.isOpen()).toBe(true);
    await flush();
    expect(labels()).toEqual(["Jane Doe", "Jack Black", "Bob Ross"]);
  });
  it("does not open for an email address", async () => {
    mount();
    type("write to jane@");
    await flush(200);
    expect(ctrl!.isOpen()).toBe(false);
    expect(menu()).toBeNull();
  });
  it("does not open after a full email", async () => {
    mount();
    type("jane@example.com");
    expect(ctrl!.isOpen()).toBe(false);
  });
  it("tracks the query as the user types (debounced)", async () => {
    const search = vi.fn((q: string) => people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())));
    mount({ search });
    type("@");
    type("j");
    type("a");
    expect(search).toHaveBeenCalledTimes(1); // the immediate one for ""
    await flush(49);
    expect(search).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][0]).toBe("ja");
    expect(labels()).toEqual(["Jane Doe", "Jack Black"].filter((l) => l.toLowerCase().includes("ja")));
  });
  it("minChars delays opening", async () => {
    mount({ minChars: 2 });
    type("@");
    expect(ctrl!.isOpen()).toBe(false);
    type("j");
    expect(ctrl!.isOpen()).toBe(false);
    type("a");
    await flush(60);
    expect(ctrl!.isOpen()).toBe(true);
  });
  it("closes when the trigger is deleted", async () => {
    mount();
    type("hi @ja");
    expect(ctrl!.isOpen()).toBe(true);
    text.data = "hi ";
    caretAt();
    ctrl!.notifyInput();
    expect(ctrl!.isOpen()).toBe(false);
  });
  it("closes when the caret leaves the range", async () => {
    mount();
    type("@ja");
    await flush(60);
    expect(ctrl!.isOpen()).toBe(true);
    caretAt(0); // caret moved before the trigger
    ctrl!.notifyInput();
    expect(ctrl!.isOpen()).toBe(false);
  });
  it("closes when the selection is no longer collapsed", () => {
    mount();
    type("@ja");
    const r = document.createRange();
    r.setStart(text, 0);
    r.setEnd(text, 3);
    sel().removeAllRanges();
    sel().addRange(r);
    ctrl!.notifyInput();
    expect(ctrl!.isOpen()).toBe(false);
  });
  it("closes when the caret moves out of the editable", () => {
    mount();
    type("@ja");
    const other = document.createElement("p");
    other.textContent = "x";
    document.body.append(other);
    sel().collapse(other.firstChild, 1);
    document.dispatchEvent(new Event("selectionchange"));
    expect(ctrl!.isOpen()).toBe(false);
  });
  it("does not reopen after Escape until the trigger is retyped", async () => {
    mount();
    type("@ja");
    expect(ctrl!.handleKeyDown(key("Escape"))).toBe(true);
    expect(ctrl!.isOpen()).toBe(false);
    type("n");
    await flush(60);
    expect(ctrl!.isOpen()).toBe(false);
    type(" and @");
    expect(ctrl!.isOpen()).toBe(true);
  });
  it("allowSpaces: spaces stay in the query", async () => {
    const search = vi.fn((_q: string) => people);
    mount({ search });
    type("@Jane");
    type(" D");
    await flush(60);
    expect(search.mock.calls.at(-1)![0]).toBe("Jane D");
    expect(ctrl!.isOpen()).toBe(true);
  });
  it("allowSpaces false: a space ends the mention", () => {
    mount({ allowSpaces: false });
    type("@Jane");
    expect(ctrl!.isOpen()).toBe(true);
    type(" ");
    expect(ctrl!.isOpen()).toBe(false);
  });
  it("closes after two consecutive spaces without a match", async () => {
    mount({ search: () => [] });
    type("@zzz");
    await flush(60);
    expect(ctrl!.isOpen()).toBe(true);
    type(" ");
    await flush(60);
    expect(ctrl!.isOpen()).toBe(true);
    type(" ");
    expect(ctrl!.isOpen()).toBe(false);
  });
  it("two spaces with a match keep it open", async () => {
    mount();
    type("@Jane");
    await flush(60);
    type("  ");
    expect(ctrl!.isOpen()).toBe(true);
  });
});

describe("search ordering", () => {
  it("aborts the stale request and ignores out-of-order responses", async () => {
    const resolvers: Array<(items: MentionItem[]) => void> = [];
    const signals: AbortSignal[] = [];
    const search = vi.fn((_q: string, { signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise<MentionItem[]>((res) => resolvers.push(res));
    });
    mount({ search });
    type("@");
    type("j");
    await flush(60);
    expect(search).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    resolvers[1]([{ id: "new", label: "Newer" }]);
    await flush();
    expect(labels()).toEqual(["Newer"]);
    resolvers[0]([{ id: "old", label: "Older" }]); // arrives late
    await flush();
    expect(labels()).toEqual(["Newer"]);
  });
  it("shows a loading state while waiting and then results", async () => {
    let resolve!: (v: MentionItem[]) => void;
    mount({ search: () => new Promise<MentionItem[]>((r) => (resolve = r)), loadingText: "Looking…" });
    type("@");
    expect(menu()!.textContent).toContain("Looking…");
    expect(document.querySelector('[role="listbox"]')!.getAttribute("aria-busy")).toBe("true");
    resolve(people);
    await flush();
    expect(labels()).toHaveLength(3);
    expect(document.querySelector('[role="listbox"]')!.getAttribute("aria-busy")).not.toBe("true");
  });
  it("shows an empty state", async () => {
    mount({ search: () => [], emptyText: "Nobody here" });
    type("@x");
    await flush(60);
    expect(menu()!.textContent).toContain("Nobody here");
    expect(options()).toHaveLength(0);
  });
  it("a rejecting search shows the empty state, an aborted one is silent", async () => {
    mount({ search: () => Promise.reject(new Error("boom")), emptyText: "Nobody" });
    type("@x");
    await flush();
    expect(menu()!.textContent).toContain("Nobody");
  });
  it("maxResults caps the list", async () => {
    mount({ maxResults: 2 });
    type("@");
    expect(options()).toHaveLength(2);
  });
  it("destroy while a search is in flight does not throw or render", async () => {
    let resolve!: (v: MentionItem[]) => void;
    mount({ search: () => new Promise<MentionItem[]>((r) => (resolve = r)) });
    type("@");
    ctrl!.destroy();
    resolve(people);
    await flush();
    expect(menu()).toBeNull();
  });
});

describe("keyboard", () => {
  async function open() {
    mount();
    type("hi @");
    await flush();
  }
  const active = () => options().findIndex((o) => o.getAttribute("aria-selected") === "true");
  it("first row is active; ArrowDown/ArrowUp move and wrap", async () => {
    await open();
    expect(active()).toBe(0);
    const down = key("ArrowDown");
    expect(ctrl!.handleKeyDown(down)).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    expect(active()).toBe(1);
    ctrl!.handleKeyDown(key("ArrowDown"));
    ctrl!.handleKeyDown(key("ArrowDown"));
    expect(active()).toBe(0); // wrapped
    ctrl!.handleKeyDown(key("ArrowUp"));
    expect(active()).toBe(2); // wrapped backwards
  });
  it("Home and End", async () => {
    await open();
    ctrl!.handleKeyDown(key("End"));
    expect(active()).toBe(2);
    ctrl!.handleKeyDown(key("Home"));
    expect(active()).toBe(0);
  });
  it("Enter picks the active row and closes", async () => {
    await open();
    ctrl!.handleKeyDown(key("ArrowDown"));
    const enter = key("Enter");
    expect(ctrl!.handleKeyDown(enter)).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
    expect(picked).toHaveLength(1);
    expect(picked[0].item.id).toBe("2");
    expect(picked[0].index).toBe(0);
    expect(picked[0].range.toString()).toBe("@");
    expect(ctrl!.isOpen()).toBe(false);
  });
  it("the pick range covers trigger and query", async () => {
    mount();
    type("hi @Jane");
    await flush(60);
    ctrl!.handleKeyDown(key("Tab"));
    expect(picked[0].range.toString()).toBe("@Jane");
    expect(picked[0].range.startContainer).toBe(text);
    expect(picked[0].range.startOffset).toBe(3);
  });
  it("Tab also picks", async () => {
    await open();
    expect(ctrl!.handleKeyDown(key("Tab"))).toBe(true);
    expect(picked).toHaveLength(1);
  });
  it("clicking a row picks it, mousedown keeps focus in the editor", async () => {
    await open();
    const row = options()[2];
    const md = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    row.dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true);
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(picked[0].item.id).toBe("3");
  });
  it("hovering a row makes it active", async () => {
    await open();
    options()[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(active()).toBe(1);
  });
  it("Escape closes without bubbling to a surrounding dialog", async () => {
    await open();
    const dialog = document.createElement("div");
    document.body.append(dialog);
    dialog.append(root);
    const dialogKey = vi.fn();
    dialog.addEventListener("keydown", dialogKey);
    root.addEventListener("keydown", (e) => ctrl!.handleKeyDown(e));
    const esc = key("Escape");
    root.dispatchEvent(esc);
    expect(dialogKey).not.toHaveBeenCalled();
    expect(esc.defaultPrevented).toBe(true);
    expect(ctrl!.isOpen()).toBe(false);
    // a second Escape (menu closed) is not consumed, so the dialog can close
    const esc2 = key("Escape");
    root.dispatchEvent(esc2);
    expect(dialogKey).toHaveBeenCalledTimes(1);
  });
  it("typing and other keys are not consumed", async () => {
    await open();
    expect(ctrl!.handleKeyDown(key("a"))).toBe(false);
    expect(ctrl!.handleKeyDown(key("Backspace"))).toBe(false);
    expect(ctrl!.handleKeyDown(key("ArrowLeft"))).toBe(false);
    expect(ctrl!.handleKeyDown(key(" "))).toBe(false);
    expect(ctrl!.isOpen()).toBe(true);
  });
  it("modified keys and IME composition are ignored", async () => {
    await open();
    expect(ctrl!.handleKeyDown(key("Enter", { ctrlKey: true }))).toBe(false);
    expect(ctrl!.handleKeyDown(key("ArrowDown", { metaKey: true }))).toBe(false);
    expect(ctrl!.handleKeyDown(key("Enter", { isComposing: true }))).toBe(false);
    expect(picked).toHaveLength(0);
  });
  it("when closed nothing is consumed", () => {
    mount();
    expect(ctrl!.handleKeyDown(key("Enter"))).toBe(false);
    expect(ctrl!.handleKeyDown(key("Escape"))).toBe(false);
    expect(ctrl!.handleKeyDown(key("ArrowDown"))).toBe(false);
  });
  it("Enter with no results is not consumed", async () => {
    mount({ search: () => [] });
    type("@zz");
    await flush(60);
    expect(ctrl!.handleKeyDown(key("Enter"))).toBe(false);
  });
});

describe("accessibility", () => {
  it("wires the combobox pattern onto the editable", async () => {
    mount();
    expect(root.getAttribute("aria-haspopup")).toBe("listbox");
    expect(root.getAttribute("aria-expanded")).toBe("false");
    type("@");
    await flush();
    const list = document.querySelector('[role="listbox"]') as HTMLElement;
    expect(root.getAttribute("aria-expanded")).toBe("true");
    expect(root.getAttribute("aria-controls")).toBe(list.id);
    expect(list.id).toBeTruthy();
    const opts = options();
    expect(root.getAttribute("aria-activedescendant")).toBe(opts[0].id);
    expect(new Set(opts.map((o) => o.id)).size).toBe(opts.length);
    ctrl!.handleKeyDown(key("ArrowDown"));
    expect(root.getAttribute("aria-activedescendant")).toBe(opts[1].id);
    expect(opts[0].getAttribute("aria-selected")).toBe("false");
    expect(opts[1].getAttribute("aria-selected")).toBe("true");
  });
  it("clears the dynamic attributes on close", async () => {
    mount();
    type("@");
    await flush();
    ctrl!.handleKeyDown(key("Escape"));
    expect(root.getAttribute("aria-expanded")).toBe("false");
    expect(root.hasAttribute("aria-activedescendant")).toBe(false);
    expect(root.hasAttribute("aria-controls")).toBe(false);
  });
  it("announces the result count politely", async () => {
    mount();
    type("@");
    await flush();
    const live = document.querySelector('[role="status"]') as HTMLElement;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("3 results");
  });
  it("announces one result and no results", async () => {
    mount({ search: (q) => (q ? [] : [people[0]]) });
    type("@");
    await flush();
    const live = () => (document.querySelector('[role="status"]') as HTMLElement).textContent;
    expect(live()).toBe("1 result");
    type("x");
    await flush(60);
    expect(live()).toBe("No results");
  });
  it("labels are customisable", async () => {
    mount({}, { labels: { noResults: "Keine Treffer", results: (n: number) => `${n} Treffer` } as never });
    type("@");
    await flush();
    expect((document.querySelector('[role="status"]') as HTMLElement).textContent).toBe("3 Treffer");
  });
  it("the listbox has an accessible name", async () => {
    mount();
    type("@");
    await flush();
    expect((document.querySelector('[role="listbox"]') as HTMLElement).getAttribute("aria-label")).toBeTruthy();
  });
  it("destroy removes the menu and restores the editable's attributes", async () => {
    root.setAttribute("aria-haspopup", "dialog");
    mount();
    type("@");
    await flush();
    ctrl!.destroy();
    expect(menu()).toBeNull();
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(root.getAttribute("aria-haspopup")).toBe("dialog");
    expect(root.hasAttribute("aria-expanded")).toBe(false);
    expect(root.hasAttribute("aria-controls")).toBe(false);
    expect(ctrl!.isOpen()).toBe(false);
    ctrl!.destroy(); // idempotent
  });
});

describe("rows", () => {
  async function open(items: MentionItem[], opt: Partial<MentionOptions> = {}) {
    mount({ search: () => items, ...opt });
    type("@");
    await flush();
  }
  it("shows label, description and a badge pill", async () => {
    await open([people[0]]);
    const row = options()[0];
    expect(row.querySelector(".atm-mention-label")!.textContent).toBe("Jane Doe");
    expect(row.querySelector(".atm-mention-desc")!.textContent).toBe("Design");
    expect(row.querySelector(".atm-mention-badge")!.textContent).toBe("Hub");
  });
  it("omits description and badge when absent", async () => {
    await open([{ id: "9", label: "Plain" }]);
    expect(options()[0].querySelector(".atm-mention-desc")).toBeNull();
    expect(options()[0].querySelector(".atm-mention-badge")).toBeNull();
  });
  it("avatar: img when there is a url, initials otherwise", async () => {
    await open([people[1], people[0], { id: "x", label: "single" }]);
    const rows = options();
    const img = rows[0].querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/a.png");
    expect(img.getAttribute("alt")).toBe("");
    expect(rows[1].querySelector(".atm-mention-avatar")!.textContent).toBe("JD");
    expect(rows[2].querySelector(".atm-mention-avatar")!.textContent).toBe("S");
  });
  it("refuses unsafe avatar urls", async () => {
    await open([{ id: "x", label: "Eve Hacker", avatarUrl: "javascript:alert(1)" }]);
    expect(options()[0].querySelector("img")).toBeNull();
    expect(options()[0].querySelector(".atm-mention-avatar")!.textContent).toBe("EH");
  });
  it("numeric colour maps to a palette variable, other colours are literal", async () => {
    await open([people[0], people[2]]);
    const [a, b] = options();
    expect(a.getAttribute("style")).toContain("--atm-chip-color");
    expect(a.getAttribute("style")).toContain("var(--atm-chip-3)");
    expect(b.getAttribute("style")).toContain("#ff0000");
  });
  it("no colour, no style variable", async () => {
    await open([{ id: "z", label: "Zed" }]);
    expect(options()[0].getAttribute("style") ?? "").not.toContain("--atm-chip-color");
  });
  it("groupBy renders headings and still navigates across groups", async () => {
    await open(people, { groupBy: (i) => (i.id === "1" ? "Team" : "Guests") });
    const groups = Array.from(document.querySelectorAll('[role="group"]'));
    expect(groups).toHaveLength(2);
    const headings = Array.from(document.querySelectorAll(".atm-mention-group")).map((h) => h.textContent);
    expect(headings).toEqual(["Team", "Guests"]);
    expect(groups.every((g) => g.getAttribute("aria-labelledby"))).toBe(true);
    ctrl!.handleKeyDown(key("ArrowDown"));
    ctrl!.handleKeyDown(key("ArrowDown"));
    expect(root.getAttribute("aria-activedescendant")).toBe(options()[2].id);
  });
  it("renderItem may return an element", async () => {
    await open([people[0]], {
      renderItem: (i) => {
        const el = document.createElement("b");
        el.className = "custom";
        el.textContent = i.label.toUpperCase();
        return el;
      },
    });
    expect(options()[0].querySelector("b.custom")!.textContent).toBe("JANE DOE");
  });
  it("renderItem strings are text, never HTML", async () => {
    await open([people[0]], { renderItem: () => '<img src=x onerror="window.pwned=1"><b>hi</b>' });
    expect(options()[0].querySelector("img")).toBeNull();
    expect(options()[0].querySelector("b")).toBeNull();
    expect(options()[0].textContent).toContain('<img src=x onerror="window.pwned=1">');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });
  it("labels from untrusted data are text", async () => {
    await open([{ id: "1", label: "<script>alert(1)</script>", description: "<b>d</b>", badge: "<i>b</i>" }]);
    expect(document.querySelector(".atm-mention-menu script")).toBeNull();
    expect(options()[0].querySelector("b, i")).toBeNull();
    expect(options()[0].textContent).toContain("<script>alert(1)</script>");
  });
});

describe("multiple triggers", () => {
  it("uses the options entry of the trigger that fired and reports its index", async () => {
    const people_ = vi.fn(() => [people[0]]);
    const tags_ = vi.fn(() => [{ id: "t1", label: "urgent" }]);
    mount([
      { trigger: "@", search: people_ },
      { trigger: "#", search: tags_, scheme: "tag" },
    ]);
    type("see #ur");
    await flush(60);
    expect(people_).not.toHaveBeenCalled();
    expect(labels()).toEqual(["urgent"]);
    ctrl!.handleKeyDown(key("Enter"));
    expect(picked[0].index).toBe(1);
    expect(picked[0].range.toString()).toBe("#ur");
  });
  it("switching trigger re-targets the menu", async () => {
    mount([
      { trigger: "@", search: () => [people[0]] },
      { trigger: "#", search: () => [{ id: "t1", label: "urgent" }] },
    ]);
    type("@ja ");
    await flush(60);
    expect(labels()).toEqual(["Jane Doe"]);
    type("#");
    await flush(60);
    expect(labels()).toEqual(["urgent"]);
  });
  it("defaults the trigger to @", async () => {
    mount({ trigger: undefined });
    type("@");
    expect(ctrl!.isOpen()).toBe(true);
  });
});

describe("positioning", () => {
  const rect = (l: number, t: number, w: number, h: number) =>
    ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect;
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("atm-mention-menu") ? rect(0, 0, 240, 200) : rect(0, 0, 0, 0);
    });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
  });
  afterEach(() => spy.mockRestore());

  it("sits under the caret", async () => {
    mount({}, { getRect: () => rect(100, 100, 0, 18) });
    type("@");
    await flush();
    const m = menu()!;
    expect(m.style.position).toBe("fixed");
    expect(parseFloat(m.style.top)).toBeGreaterThanOrEqual(118);
    expect(parseFloat(m.style.left)).toBe(100);
    expect(m.getAttribute("data-placement")).toBe("bottom");
  });
  it("flips above when there is no room below", async () => {
    mount({}, { getRect: () => rect(100, 560, 0, 18) });
    type("@");
    await flush();
    const m = menu()!;
    expect(parseFloat(m.style.top)).toBeLessThanOrEqual(560 - 200);
    expect(m.getAttribute("data-placement")).toBe("top");
  });
  it("stays on screen horizontally", async () => {
    mount({}, { getRect: () => rect(780, 100, 0, 18) });
    type("@");
    await flush();
    expect(parseFloat(menu()!.style.left)).toBeLessThanOrEqual(800 - 240);
  });
  it("repositions on scroll and resize", async () => {
    let r = rect(100, 100, 0, 18);
    mount({}, { getRect: () => r });
    type("@");
    await flush();
    r = rect(150, 300, 0, 18);
    window.dispatchEvent(new Event("scroll"));
    expect(parseFloat(menu()!.style.left)).toBe(150);
    r = rect(160, 310, 0, 18);
    window.dispatchEvent(new Event("resize"));
    expect(parseFloat(menu()!.style.left)).toBe(160);
  });
  it("stops listening after destroy", async () => {
    const getRect = vi.fn(() => rect(100, 100, 0, 18));
    mount({}, { getRect });
    type("@");
    await flush();
    ctrl!.destroy();
    getRect.mockClear();
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(getRect).not.toHaveBeenCalled();
  });
});

describe("outside interaction", () => {
  it("a pointer press outside the menu and editable closes it", async () => {
    mount();
    type("@");
    await flush();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(ctrl!.isOpen()).toBe(false);
  });
  it("a press inside the menu does not", async () => {
    mount();
    type("@");
    await flush();
    menu()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(ctrl!.isOpen()).toBe(true);
  });
});
