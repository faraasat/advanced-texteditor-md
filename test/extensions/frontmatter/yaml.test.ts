import { describe, expect, it } from "vitest";
import { parseYamlSubset, renameYamlKey, stringifyYamlValue, updateYaml, YAML_LIMITS } from "../../../src/extensions/frontmatter/yaml";

const kinds = (y: string) => parseYamlSubset(y).entries.map((e) => [e.key, e.kind, e.readonly]);

describe("parseYamlSubset: scalars", () => {
  it("reads plain, quoted, numbers, booleans, null and dates", () => {
    const y = [
      "title: Hello world",
      "single: 'it''s'",
      'double: "a\\tb \\"q\\" \\u00e9 \\x41"',
      "int: 42",
      "neg: -7",
      "float: 1.50",
      "exp: 2e3",
      "yes: true",
      "no: False",
      "nothing: null",
      "tilde: ~",
      "empty:",
      "date: 2026-10-02",
      "notdate: 2026-13-45",
      "url: https://example.com/a?b=c#frag",
      "word: yes",
    ].join("\n");
    const r = parseYamlSubset(y);
    expect(r.tooLarge).toBe(false);
    expect(r.data.title).toBe("Hello world");
    expect(r.data.single).toBe("it's");
    expect(r.data.double).toBe('a\tb "q" \u00e9 A');
    expect(r.data.int).toBe(42);
    expect(r.data.neg).toBe(-7);
    expect(r.data.float).toBe(1.5);
    expect(r.data.exp).toBe(2000);
    expect(r.data.yes).toBe(true);
    expect(r.data.no).toBe(false);
    expect(r.data.nothing).toBeNull();
    expect(r.data.tilde).toBeNull();
    expect(r.data.empty).toBeNull();
    expect(r.data.date).toBe("2026-10-02");
    expect(r.data.notdate).toBe("2026-13-45");
    expect(r.data.url).toBe("https://example.com/a?b=c#frag");
    // YAML 1.2 core schema: `yes` is a string.
    expect(r.data.word).toBe("yes");
    const byKey = Object.fromEntries(r.entries.map((e) => [e.key, e]));
    expect(byKey.date.kind).toBe("date");
    expect(byKey.notdate.kind).toBe("string");
    expect(byKey.float.kind).toBe("number");
    expect(byKey.float.text).toBe("1.50");
    expect(byKey.empty.kind).toBe("null");
    expect(r.entries.every((e) => !e.readonly)).toBe(true);
  });

  it("keeps inline comments out of the value", () => {
    const r = parseYamlSubset("a: 1 # one\nb: 'x # y' # z\nc: text#not-a-comment");
    expect(r.data.a).toBe(1);
    expect(r.data.b).toBe("x # y");
    expect(r.data.c).toBe("text#not-a-comment");
  });

  it("quoted keys", () => {
    const r = parseYamlSubset("\"my key\": 1\n'it''s': 2\na:b: 3");
    expect(Object.keys(r.data)).toEqual(["my key", "it's", "a:b"]);
  });

  it("data has no prototype and prototype keys are plain data", () => {
    const r = parseYamlSubset("__proto__: x\nconstructor: y\ntoString: z\nhasOwnProperty: 1");
    expect(Object.getPrototypeOf(r.data)).toBeNull();
    expect(r.data.__proto__).toBe("x");
    expect(r.data.constructor).toBe("y");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.keys(r.data)).toEqual(["__proto__", "constructor", "toString", "hasOwnProperty"]);
  });
});

describe("parseYamlSubset: lists and maps", () => {
  it("flow lists", () => {
    const r = parseYamlSubset("tags: [a, 'b, c', \"d\", 3, true]\nnone: []\ntrail: [x, y,]");
    expect(r.data.tags).toEqual(["a", "b, c", "d", 3, true]);
    expect(r.data.none).toEqual([]);
    expect(r.data.trail).toEqual(["x", "y"]);
    expect(kinds("tags: [a, b]")).toEqual([["tags", "list", false]]);
  });

  it("block lists, indented or not", () => {
    const r = parseYamlSubset("a:\n  - one\n  - 'two'\n  - 3\nb:\n- x\n- y # c\nc:\n  -\n");
    expect(r.data.a).toEqual(["one", "two", 3]);
    expect(r.data.b).toEqual(["x", "y"]);
    expect(r.data.c).toEqual([null]);
  });

  it("flat maps one level deep", () => {
    const r = parseYamlSubset("author:\n  name: Ada\n  email: ada@example.com\n  tags: [a, b]\nnext: 1");
    expect(r.data.author).toEqual({ name: "Ada", email: "ada@example.com", tags: ["a", "b"] });
    expect(Object.getPrototypeOf(r.data.author)).toBeNull();
    expect(r.data.next).toBe(1);
    expect(kinds("m:\n  a: 1")).toEqual([["m", "map", false]]);
  });
});

describe("parseYamlSubset: what is kept as written", () => {
  const ro: [string, string][] = [
    ["anchor: &a 1", "anchor"],
    ["alias: *a", "alias"],
    ["tag: !!str 1", "tag"],
    ["block: |\n  line 1\n  line 2", "block-scalar"],
    ["folded: >-\n  text", "block-scalar"],
    ["deep:\n  a:\n    b: 1", "nested"],
    ["seqmap:\n  - a: 1", "nested"],
    ["seqseq:\n  - - 1", "nested"],
    ["flowmap: {a: 1}", "flow-map"],
    ["nestedflow: [a, [b]]", "nested"],
    ["multi: [a,\n  b]", "multiline"],
    ['dq: "open', "syntax"],
    ["plain: a: b", "syntax"],
    ["multiline: one\n  two", "multiline"],
    ["withcomment:\n  - a\n  # c\n  - b", "comment-inside"],
    ["inf: .inf", "special-number"],
    ["hex: 0x1F", "special-number"],
    ["big: 123456789012345678901234567890", "special-number"],
    ["<<: *base", "merge-key"],
    ["? complex", "not-a-key"],
    ["- top level item", "not-a-key"],
    ["just text", "not-a-key"],
    ["tabbed:\n\t- a", "syntax"],
    ["bad: \"\\q\"", "syntax"],
  ];
  for (const [y, reason] of ro) {
    it(JSON.stringify(y), () => {
      const r = parseYamlSubset(y);
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]).toMatchObject({ readonly: true, kind: "raw", reason });
      expect(r.entries[0].raw).toBe(y);
      expect(updateYaml(y, {})).toBe(y);
    });
  }

  it("duplicate keys are all read-only; data holds the last", () => {
    const r = parseYamlSubset("a: 1\nb: 2\na: 3");
    expect(r.entries.filter((e) => e.key === "a").every((e) => e.readonly && e.reason === "duplicate")).toBe(true);
    expect(r.data.a).toBe(3);
    expect(r.entries.find((e) => e.key === "b")!.readonly).toBe(false);
  });

  it("comments and blank lines are not entries", () => {
    const r = parseYamlSubset("# head\n\na: 1\n  # indented comment after\n\n# tail");
    expect(r.entries.map((e) => [e.key, e.start, e.end])).toEqual([["a", 2, 3]]);
  });

  it("over the size limit: one read-only entry, writer refuses", () => {
    const y = "a: " + "x".repeat(YAML_LIMITS.chars);
    const r = parseYamlSubset(y);
    expect(r.tooLarge).toBe(true);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ readonly: true, reason: "too-large" });
    expect(updateYaml(y, { a: 1 })).toBeNull();
    const many = Array.from({ length: YAML_LIMITS.entries + 1 }, (_, i) => `k${i}: ${i}`).join("\n");
    expect(parseYamlSubset(many).tooLarge).toBe(true);
  });
});

describe("stringifyYamlValue", () => {
  it("plain when safe, double-quoted otherwise", () => {
    expect(stringifyYamlValue("Hello world")).toBe("Hello world");
    expect(stringifyYamlValue("")).toBe('""');
    expect(stringifyYamlValue("true")).toBe('"true"');
    expect(stringifyYamlValue("yes")).toBe('"yes"');
    expect(stringifyYamlValue("12")).toBe('"12"');
    expect(stringifyYamlValue("1:20")).toBe('"1:20"');
    expect(stringifyYamlValue("2026-10-02")).toBe('"2026-10-02"');
    expect(stringifyYamlValue("a: b")).toBe('"a: b"');
    expect(stringifyYamlValue("a #b")).toBe('"a #b"');
    expect(stringifyYamlValue("- x")).toBe('"- x"');
    expect(stringifyYamlValue(" lead")).toBe('" lead"');
    expect(stringifyYamlValue("line\nbreak")).toBe('"line\\nbreak"');
    // A quote or backslash inside a plain scalar is literal YAML.
    expect(stringifyYamlValue('q"\\')).toBe('q"\\');
    // YAML 1.1 booleans are quoted, also as keys (`n:` is the key false there).
    expect(updateYaml("", { n: 1 })).toBe('"n": 1');
    expect(stringifyYamlValue("a\u202eb")).toBe('"a\\u202Eb"');
    expect(stringifyYamlValue("\u0007")).toBe('"\\x07"');
    expect(stringifyYamlValue(3)).toBe("3");
    expect(stringifyYamlValue(1.5)).toBe("1.5");
    expect(stringifyYamlValue(Infinity)).toBe(".inf");
    expect(stringifyYamlValue(-Infinity)).toBe("-.inf");
    expect(stringifyYamlValue(NaN)).toBe(".nan");
    expect(stringifyYamlValue(true)).toBe("true");
    expect(stringifyYamlValue(null)).toBe("null");
    expect(stringifyYamlValue(["a", "b, c", 1])).toBe('[a, "b, c", 1]');
    expect(stringifyYamlValue([])).toBe("[]");
    expect(stringifyYamlValue({ a: 1, "b c": "x" })).toBe("{a: 1, b c: x}");
  });

  it("every written value reads back as itself", () => {
    const vals = ["x", "", "true", "null", "~", "12", "-3", "1e3", ".inf", "2026-10-02", "a: b", "#x", "[a]", "{a}", "it's", 'q"', "\\", "tab\there", "\u00e9 \u00fc \u6f22\u5b57", "a\u2028b", "\u202e", " x ", "- a", "? a", "@x", "`x`", "%x", "!x", "&x", "*x", "|", ">", "a,b"];
    for (const v of vals) {
      const r = parseYamlSubset("k: " + stringifyYamlValue(v));
      expect(r.entries[0].readonly, v).toBe(false);
      expect(r.data.k, v).toBe(v);
      const l = parseYamlSubset("k: " + stringifyYamlValue([v, v]));
      expect(l.data.k, v).toEqual([v, v]);
    }
    for (const v of [0, 1, -1, 1.25, 1e21, 123456789, true, false, null]) expect(parseYamlSubset("k: " + stringifyYamlValue(v)).data.k).toBe(v);
  });
});

describe("updateYaml: minimal diff", () => {
  const src = [
    "# A comment that must survive",
    "title:   'Draft'   # keep me",
    "date: 2026-10-02",
    "",
    "draft: true",
    "tags:",
    "  - one",
    "  - 'two'",
    "flow: [a, 'b']",
    "author:",
    "  name: Ada",
    "  role: editor # who",
    "weird: &x anchored",
    "# trailing",
  ].join("\n");

  const changedLines = (a: string, b: string) => {
    const x = a.split("\n");
    const y = b.split("\n");
    const out: number[] = [];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(i);
    return out;
  };

  it("no edits: identical", () => {
    expect(updateYaml(src, {})).toBe(src);
    expect(updateYaml(src, { title: "Draft" })).toBe(src);
    expect(updateYaml(src, { tags: ["one", "two"] })).toBe(src);
  });

  it("a scalar edit changes only its line and keeps the quoting style, gap and comment", () => {
    const out = updateYaml(src, { title: "Final" })!;
    expect(changedLines(src, out)).toEqual([1]);
    expect(out.split("\n")[1]).toBe("title:   'Final'   # keep me");
    expect(updateYaml(src, { date: "2026-10-03" })!.split("\n")[2]).toBe("date: 2026-10-03");
    expect(updateYaml(src, { draft: false })!.split("\n")[4]).toBe("draft: false");
    expect(changedLines(src, updateYaml(src, { draft: false })!)).toEqual([4]);
  });

  it("a block list edit keeps the untouched item lines byte for byte", () => {
    const out = updateYaml(src, { tags: ["one", "two", "three"] })!;
    expect(out.split("\n").slice(5, 9)).toEqual(["tags:", "  - one", "  - 'two'", "  - three"]);
    const rm = updateYaml(src, { tags: ["two"] })!;
    expect(rm.split("\n").slice(5, 7)).toEqual(["tags:", "  - 'two'"]);
    expect(updateYaml(src, { tags: [] })!.split("\n")[5]).toBe("tags: []");
  });

  it("flow lists and maps", () => {
    expect(updateYaml(src, { flow: ["a", "'b'", "c"] })!.split("\n")[8]).toBe(`flow: [a, "'b'", c]`);
    expect(updateYaml(src, { flow: ["b", "c"] })!.split("\n")[8]).toBe("flow: ['b', c]");
    const m = updateYaml(src, { author: { name: "Grace", role: "editor" } })!;
    expect(m.split("\n").slice(9, 12)).toEqual(["author:", "  name: Grace", "  role: editor # who"]);
    expect(changedLines(src, m)).toEqual([10]);
  });

  it("adding appends a line; removing deletes only that entry's lines", () => {
    const add = updateYaml(src, { summary: "Short: text" })!;
    expect(add).toBe(src + '\nsummary: "Short: text"');
    const rm = updateYaml(src, { tags: undefined })!;
    expect(rm.split("\n")).toEqual(src.split("\n").filter((_, i) => i < 5 || i > 7));
    expect(updateYaml("", { a: 1 })).toBe("a: 1");
    expect(updateYaml("a: 1", { a: undefined })).toBe("");
  });

  it("merge: false removes keys that are not given, but keeps entries it cannot read", () => {
    const out = updateYaml(src, { title: "Draft" }, { merge: false })!;
    expect(out.split("\n")).toEqual(["# A comment that must survive", "title:   'Draft'   # keep me", "", "weird: &x anchored", "# trailing"]);
  });

  it("setting a read-only entry replaces it; a duplicated key becomes one entry", () => {
    expect(updateYaml("a: &x 1\nb: 2", { a: 5 })).toBe("a: 5\nb: 2");
    expect(updateYaml("a: 1\nb: 2\na: 3", { a: 4 })).toBe("a: 4\nb: 2");
  });

  it("new values: dates plain, other date-looking strings of string entries quoted, Date objects", () => {
    expect(updateYaml("", { d: "2026-10-02" })).toBe("d: 2026-10-02");
    expect(updateYaml("s: 'x'", { s: "2026-10-02" })).toBe("s: '2026-10-02'");
    expect(updateYaml("s: x", { s: "2026-10-02" })).toBe('s: "2026-10-02"');
    expect(updateYaml("", { d: new Date(Date.UTC(2026, 9, 2)) })).toBe("d: 2026-10-02");
    expect(updateYaml("", { none: null })).toBe("none:");
    expect(updateYaml("", { l: ["a"] })).toBe("l: [a]");
    expect(updateYaml("", { m: { a: 1 } })).toBe("m:\n  a: 1");
  });

  it("keys that need quoting", () => {
    expect(updateYaml("", { "a: b": 1, "": 2, "#x": 3 })).toBe('"a: b": 1\n"": 2\n"#x": 3');
    expect(parseYamlSubset('"a: b": 1\n"": 2\n"#x": 3').data).toEqual(Object.assign(Object.create(null), { "a: b": 1, "": 2, "#x": 3 }));
  });

  it("prototype keys are written and read as data", () => {
    const patch = JSON.parse('{"__proto__": "p", "constructor": 1}');
    const out = updateYaml("", patch)!;
    expect(out).toBe("__proto__: p\nconstructor: 1");
    expect(({} as Record<string, unknown>).p).toBeUndefined();
  });
});

describe("renameYamlKey", () => {
  it("rewrites only the key", () => {
    expect(renameYamlKey("a: 1 # c\nb: 2", "a", "z")).toBe("z: 1 # c\nb: 2");
    expect(renameYamlKey("tags:\n  - x", "tags", "labels")).toBe("labels:\n  - x");
    expect(renameYamlKey("a: 1", "a", "b c: d")).toBe('"b c: d": 1');
    expect(renameYamlKey("a: 1\nb: 2", "a", "b")).toBeNull();
    expect(renameYamlKey("a: 1", "x", "y")).toBeNull();
    expect(renameYamlKey("a: 1", "a", "a")).toBe("a: 1");
  });
});

/* ───────────────────────────── property tests ───────────────────────────── */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PIECES = [
  (k: string) => `${k}: plain value`,
  (k: string) => `${k}: 'single ''q'''`,
  (k: string) => `${k}: "dq \\" \\u00e9"`,
  (k: string) => `${k}: 42 # c`,
  (k: string) => `${k}:   true`,
  (k: string) => `${k}: 2026-01-31`,
  (k: string) => `${k}:`,
  (k: string) => `${k}: [a, "b, c", 3]`,
  (k: string) => `${k}:\n  - x\n  - 'y'`,
  (k: string) => `${k}:\n- x`,
  (k: string) => `${k}:\n  a: 1\n  b: [x]`,
  (k: string) => `${k}: |\n  block\n   text`,
  (k: string) => `${k}: &anchor v`,
  (k: string) => `${k}: *anchor`,
  (k: string) => `${k}: !!binary aGk=`,
  (k: string) => `${k}: {a: 1}`,
  (k: string) => `${k}:\n  deep:\n    x: 1`,
  () => "# comment",
  () => "",
  () => "   ",
  () => "stray text",
  () => "- stray item",
  () => "? weird",
  (k: string) => `"${k} q": 1`,
  (k: string) => `${k}: x: y`,
  (k: string) => `${k}: "unterminated`,
];

function randomYaml(r: () => number): string {
  const n = 1 + Math.floor(r() * 12);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const k = r() < 0.15 ? "dup" : "k" + i;
    out.push(PIECES[Math.floor(r() * PIECES.length)](k));
  }
  return out.join("\n");
}

describe("property: random YAML-ish documents", () => {
  it("parse then write without edits is the input, 500 documents", () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const y = randomYaml(r);
      expect(updateYaml(y, {}), y).toBe(y);
      // Entries never overlap and cover only lines that exist.
      const e = parseYamlSubset(y).entries;
      for (let j = 1; j < e.length; j++) expect(e[j].start).toBeGreaterThanOrEqual(e[j - 1].end);
      for (const x of e) expect(x.raw).toBe(y.split("\n").slice(x.start, x.end).join("\n"));
    }
  });

  it("editing one key changes no line outside that entry, 500 documents", () => {
    const r = rng(11);
    for (let i = 0; i < 500; i++) {
      const y = randomYaml(r);
      const parsed = parseYamlSubset(y);
      const editable = parsed.entries.filter((e) => !e.readonly && e.key);
      if (!editable.length) continue;
      const target = editable[Math.floor(r() * editable.length)];
      const nv = target.kind === "list" ? ["new", "x"] : target.kind === "map" ? { a: "changed" } : "changed value";
      const out = updateYaml(y, { [target.key]: nv })!;
      const a = y.split("\n");
      const b = out.split("\n");
      expect(b.slice(0, target.start), y).toEqual(a.slice(0, target.start));
      const grown = b.length - a.length;
      expect(b.slice(target.end + grown), y).toEqual(a.slice(target.end));
      expect(parseYamlSubset(out).data[target.key], y).toEqual(nv);
    }
  });
});
