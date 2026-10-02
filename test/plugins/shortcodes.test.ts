import { afterEach, describe, expect, it } from "vitest";
import { createShortcodesPlugin, findClosedShortcode, pushRecent, searchShortcodes } from "../../src/plugins/shortcodes";
import { mount, pressKey, setSel, textareaReady, tick, typeInto, wait, type Mounted } from "./helpers";

const TABLE = { smile: "☺", smirk: "😏", heart: "♥", happy: "😀", hand: "✋", thumbsup: "👍", "+1": "👍", sun_with_face: "🌞", "t-rex": "🦖" };

describe("searchShortcodes", () => {
  const names = (q: string, recent: string[] = [], max = 8) => searchShortcodes(TABLE, q, recent, max);
  it("prefix matches come first, then word starts, then substrings", () => {
    expect(names("sm")).toEqual(["smile", "smirk"]);
    expect(names("face")).toEqual(["sun_with_face"]);
    expect(names("ile")).toEqual(["smile"]);
  });
  it("exact beats prefix", () => {
    expect(names("hand")[0]).toBe("hand");
    expect(searchShortcodes({ he: "a", heart: "b", hello: "c" }, "he", [], 8)[0]).toBe("he");
  });
  it("is case-insensitive", () => {
    expect(names("SMI")).toEqual(["smile", "smirk"]);
  });
  it("recently used names rank first within the same class of match", () => {
    expect(names("h").slice(0, 3)).toEqual(["hand", "happy", "heart"]);
    expect(names("h", ["heart"])[0]).toBe("heart");
    expect(names("h", ["heart", "happy"]).slice(0, 2)).toEqual(["heart", "happy"]);
  });
  it("recent does not outrank a better class of match", () => {
    expect(searchShortcodes({ hearth: "1", the: "2" }, "he", ["the"], 8)[0]).toBe("hearth");
  });
  it("respects max and returns nothing for an empty or unknown query", () => {
    expect(names("s", [], 2)).toHaveLength(2);
    expect(names("")).toEqual([]);
    expect(names("zzz")).toEqual([]);
  });
  it("names with + and - are searchable", () => {
    expect(names("+1")).toEqual(["+1"]);
    expect(names("t-")).toEqual(["t-rex"]);
  });
  it("ignores keys that cannot be typed", () => {
    expect(searchShortcodes({ "bad name": "x", ok: "y", "": "z" }, "b", [], 8)).toEqual([]);
    expect(searchShortcodes({ "bad name": "x", ok: "y" }, "ok", [], 8)).toEqual(["ok"]);
  });
});

describe("pushRecent", () => {
  it("moves a name to the front and caps the list", () => {
    expect(pushRecent(["a", "b", "c"], "c", 5)).toEqual(["c", "a", "b"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("findClosedShortcode", () => {
  const f = (s: string) => findClosedShortcode(s, TABLE);
  it("finds :name: at the end", () => {
    expect(f("hi :smile:")).toEqual({ start: 3, name: "smile", char: "☺" });
    expect(f(":heart:")).toEqual({ start: 0, name: "heart", char: "♥" });
    expect(f("(:+1:")).toEqual({ start: 1, name: "+1", char: "👍" });
  });
  it("needs a known name", () => {
    expect(f("hi :nope:")).toBeNull();
  });
  it("needs a boundary before the opening colon", () => {
    expect(f("a:smile:")).toBeNull();
    expect(f("10:30:")).toBeNull();
    expect(f("http://x:smile:")).toBeNull();
  });
  it("only at the end of the text", () => {
    expect(f(":smile: and")).toBeNull();
  });
  it("is not fooled by a lone colon or spaces", () => {
    expect(f("::")).toBeNull();
    expect(f(": smile:")).toBeNull();
  });
});

/* ───────────────────────────── in the editor ───────────────────────────── */

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  document.head.querySelectorAll("style[data-atm-plugin]").forEach((e) => e.remove());
  document.querySelectorAll("[role=listbox]").forEach((e) => e.closest(".atm-mention-menu")?.remove());
});

const memStore = () => {
  const d = new Map<string, string>();
  return { data: d, get: (k: string) => d.get(k) ?? null, set: (k: string, v: string) => void d.set(k, v) };
};
const mk = (options: Partial<Parameters<typeof createShortcodesPlugin>[0]> = {}, mountOptions: Parameters<typeof mount>[0] = {}) => {
  m = mount({ plugins: [createShortcodesPlugin({ shortcodes: TABLE, storage: memStore(), ...options })], ...mountOptions });
  const p = m.ed.element.querySelector(".atm-surface p");
  if (p) setSel(p, 0);
  return m;
};
const menu = () => document.querySelector<HTMLElement>('[role=listbox][aria-label="Shortcodes"]');
const options = () => Array.from(menu()?.querySelectorAll('[role=option]') ?? []).map((o) => o.textContent);

describe("typing", () => {
  it("replaces :name: with the character on the closing colon", async () => {
    mk();
    await typeInto(m!.surface, "hi :smile:");
    expect(m!.ed.getValue()).toBe("hi ☺");
  });
  it("leaves unknown names and times alone", async () => {
    mk();
    await typeInto(m!.surface, "at 10:30: ok :nope:");
    expect(m!.ed.getValue()).toBe("at 10:30: ok :nope:");
  });
  it("opens a listbox after the colon and two characters", async () => {
    mk();
    await typeInto(m!.surface, ":s");
    expect(menu()).toBeNull();
    await typeInto(m!.surface, "m");
    expect(menu()).toBeTruthy();
    expect(menu()!.getAttribute("role")).toBe("listbox");
    expect(options()).toHaveLength(2);
    expect(options()[0]).toContain("smile");
    expect(menu()!.querySelector("[role=option]")!.getAttribute("aria-selected")).toBe("true");
    expect(m!.surface.getAttribute("aria-controls")).toBe(menu()!.id);
  });
  it("Enter completes the highlighted option, arrows move, Escape closes", async () => {
    mk();
    await typeInto(m!.surface, "x :sm");
    pressKey(m!.surface, "ArrowDown");
    expect(menu()!.querySelectorAll("[role=option]")[1].getAttribute("aria-selected")).toBe("true");
    pressKey(m!.surface, "ArrowUp");
    const e = pressKey(m!.surface, "Enter");
    expect(e.defaultPrevented).toBe(true);
    await tick();
    expect(m!.ed.getValue()).toBe("x ☺");
    expect(menu()).toBeNull();
    await typeInto(m!.surface, " :sm");
    expect(menu()).toBeTruthy();
    pressKey(m!.surface, "Escape");
    expect(menu()).toBeNull();
  });
  it("Tab also completes", async () => {
    mk();
    await typeInto(m!.surface, ":hea");
    pressKey(m!.surface, "Tab");
    await tick();
    expect(m!.ed.getValue()).toBe("♥");
  });
  it("does not open for a colon inside a word or URL", async () => {
    mk();
    await typeInto(m!.surface, "see http://sm and 10:sm");
    expect(menu()).toBeNull();
  });
  it("ranks recently used names first", async () => {
    mk();
    await typeInto(m!.surface, ":ha");
    expect(options()[0]).toContain(":hand:");
    await typeInto(m!.surface, "p");
    pressKey(m!.surface, "Enter");
    await tick();
    await typeInto(m!.surface, " :ha");
    expect(options()[0]).toContain(":happy:");
  });
  it("closing a code that is also a prefix still replaces", async () => {
    mk({ shortcodes: { hand: "✋", handshake: "🤝" } });
    await typeInto(m!.surface, ":hand:");
    expect(m!.ed.getValue()).toBe("✋");
  });
});

describe("recent persistence", () => {
  it("stores the list through the storage you give it and reads it back", async () => {
    const st = memStore();
    mk({ storage: st, recentKey: "r" });
    await typeInto(m!.surface, ":happ");
    pressKey(m!.surface, "Enter");
    await tick();
    expect(JSON.parse(st.data.get("r")!)).toEqual(["happy"]);
    m!.destroy();
    m = null;
    mk({ storage: st, recentKey: "r" });
    await typeInto(m!.surface, ":ha");
    expect(options()[0]).toContain(":happy:");
  });
  it("a broken storage never throws", async () => {
    const bad = {
      get: () => {
        throw new Error("x");
      },
      set: () => {
        throw new Error("x");
      },
    };
    mk({ storage: bad });
    await typeInto(m!.surface, ":smile:");
    expect(m!.ed.getValue()).toBe("☺");
  });
});

describe("insertShortcode", () => {
  it("inserts the character at the caret", async () => {
    mk();
    await typeInto(m!.surface, "a b");
    expect(m!.ed.exec("insertShortcode", "heart")).toBe(true);
    expect(m!.ed.getValue()).toBe("a b♥");
  });
  it("accepts :name: and refuses unknown names", () => {
    mk();
    expect(m!.ed.exec("insertShortcode", ":heart:")).toBe(true);
    expect(m!.ed.exec("insertShortcode", "nope")).toBe(false);
    expect(m!.ed.exec("insertShortcode")).toBe(false);
    expect(m!.ed.getValue()).toBe("♥");
  });
});

describe("Markdown mode", () => {
  it("replaces on the closing colon in the source", async () => {
    mk({}, { mode: "markdown", value: "" });
    const ta = await textareaReady(m!);
    ta.focus();
    ta.value = "hi :smile:";
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: ":", bubbles: true }));
    expect(m!.ed.getValue()).toBe("hi ☺");
  });
  it("insertShortcode works there too", async () => {
    mk({}, { mode: "markdown", value: "" });
    await textareaReady(m!);
    expect(m!.ed.exec("insertShortcode", "sun_with_face")).toBe(true);
    expect(m!.ed.getValue()).toBe("🌞");
  });
  it("the menu follows the editor into WYSIWYG when it starts in Markdown mode", async () => {
    mk({}, { mode: "markdown", value: "" });
    m!.ed.setMode("wysiwyg");
    setSel(m!.surface.querySelector("p")!, 0);
    await typeInto(m!.surface, ":sm");
    expect(menu()).toBeTruthy();
  });
});

describe("lifecycle", () => {
  it("removes its menu and listeners on destroy", async () => {
    mk();
    await typeInto(m!.surface, ":sm");
    expect(menu()).toBeTruthy();
    m!.destroy();
    m = null;
    expect(menu()).toBeNull();
    await wait(0);
  });
  it("labels are overridable", async () => {
    mk({ labels: { menu: "Emoji" } });
    await typeInto(m!.surface, ":sm");
    expect(document.querySelector('[role=listbox][aria-label="Emoji"]')).toBeTruthy();
  });
  it("minChars can be raised", async () => {
    mk({ minChars: 3 });
    await typeInto(m!.surface, ":sm");
    expect(menu()).toBeNull();
    await typeInto(m!.surface, "i");
    expect(menu()).toBeTruthy();
  });
});
