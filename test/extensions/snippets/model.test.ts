import { describe, expect, it } from "vitest";
import { SNIPPET_LIMITS, normalizeSnippets, parseEnvelope, toEnvelope, validateSnippet } from "../../../src/extensions/snippets/model";

const ok = (x: unknown) => {
  const v = validateSnippet(x);
  if (!v.ok) throw new Error(v.reason);
  return v.snippet;
};
const reason = (x: unknown) => {
  const v = validateSnippet(x);
  return v.ok ? null : v.reason;
};

describe("validateSnippet", () => {
  it("rebuilds a snippet field by field", () => {
    const s = ok({ id: "sig", name: "Signature", trigger: ";sig", body: "Ada", scope: "inline", description: "d", keywords: ["a", "b"], extra: 1 });
    expect(s).toEqual({ id: "sig", name: "Signature", trigger: ";sig", body: "Ada", scope: "inline", description: "d", keywords: ["a", "b"] });
    expect(Object.keys(s)).not.toContain("extra");
  });

  it("infers the scope when none is given", () => {
    expect(ok({ id: "a", name: "A", body: "one line" }).scope).toBe("inline");
    expect(ok({ id: "a", name: "A", body: "two\nlines" }).scope).toBe("block");
  });

  it("rejects ids outside [\\w.:-]{1,80} and prototype names", () => {
    for (const id of ["", "a b", "a/b", "x".repeat(81), "__proto__", "constructor", "prototype", 5, null, undefined]) expect(reason({ id, name: "n", body: "b" })).toBe("bad-id");
    expect(ok({ id: "a.b:c-d_e", name: "n", body: "b" }).id).toBe("a.b:c-d_e");
  });

  it("rejects an unknown scope, empty name or body, bad types", () => {
    expect(reason({ id: "a", name: "n", body: "b", scope: "page" })).toBe("bad-scope");
    expect(reason({ id: "a", name: "  ", body: "b" })).toBe("bad-name");
    expect(reason({ id: "a", name: "n", body: "" })).toBe("bad-body");
    expect(reason({ id: "a", name: 3, body: "b" })).toBe("bad-name");
    expect(reason({ id: "a", name: "n", body: {} })).toBe("bad-body");
    expect(reason("x")).toBe("not-an-object");
    expect(reason([])).toBe("not-an-object");
    expect(reason(null)).toBe("not-an-object");
  });

  it("caps every length", () => {
    expect(reason({ id: "a", name: "n".repeat(121), body: "b" })).toBe("bad-name");
    expect(reason({ id: "a", name: "n", body: "b".repeat(SNIPPET_LIMITS.body + 1) })).toBe("bad-body");
    expect(ok({ id: "a", name: "n", body: "b".repeat(SNIPPET_LIMITS.body) }).body.length).toBe(SNIPPET_LIMITS.body);
    expect(reason({ id: "a", name: "n", body: "b", description: "d".repeat(301) })).toBe("bad-description");
    expect(reason({ id: "a", name: "n", body: "b", trigger: "t".repeat(33) })).toBe("bad-trigger");
    expect(reason({ id: "a", name: "n", body: "b", keywords: Array.from({ length: 21 }, (_, i) => "k" + i) })).toBe("bad-keywords");
    expect(reason({ id: "a", name: "n", body: "b", keywords: ["k".repeat(41)] })).toBe("bad-keywords");
    expect(reason({ id: "a", name: "n", body: "b", keywords: "x" })).toBe("bad-keywords");
  });

  it("rejects triggers with whitespace, control, zero-width or bidi characters", () => {
    for (const t of ["a b", "a\tb", ";s\u0000", "\u200bsig", "sig\u202e", "\u2066x", "a b", "\ufdd0"]) expect(reason({ id: "a", name: "n", body: "b", trigger: t })).toBe("bad-trigger");
    expect(ok({ id: "a", name: "n", body: "b", trigger: ";sig" }).trigger).toBe(";sig");
    expect(ok({ id: "a", name: "n", body: "b", trigger: "" }).trigger).toBeUndefined();
  });

  it("strips control and bidi characters from text, keeps newlines in the body", () => {
    const s = ok({ id: "a", name: "Na\u0000m\u202ee", body: "x\u0007y\r\nz\u2066", description: "d\n\te" });
    expect(s.name).toBe("Name");
    expect(s.body).toBe("xy\nz");
    expect(s.description).toBe("d e");
  });

  it("ignores inherited and prototype keys", () => {
    const evil = JSON.parse('{"id":"a","name":"n","body":"b","__proto__":{"scope":"block","polluted":true},"constructor":{"x":1}}');
    const s = ok(evil);
    expect(s.scope).toBe("inline");
    expect(Object.keys(s).sort()).toEqual(["body", "id", "name", "scope"]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    const inherited = Object.create({ id: "a", name: "n", body: "b" });
    expect(reason(inherited)).toBe("bad-id");
  });
});

describe("normalizeSnippets", () => {
  it("keeps valid entries in order, reports the rest, freezes", () => {
    const n = normalizeSnippets([{ id: "a", name: "A", body: "1" }, { id: "", name: "B", body: "2" }, { id: "c", name: "C", body: "3", trigger: ";c" }]);
    expect(n.list.map((s) => s.id)).toEqual(["a", "c"]);
    expect(n.sourceIndex).toEqual([0, 2]);
    expect(n.skipped).toEqual([expect.objectContaining({ index: 1, reason: "bad-id" })]);
    expect(Object.isFrozen(n.list[0])).toBe(true);
  });

  it("keeps the first of a repeated id or trigger", () => {
    const n = normalizeSnippets([
      { id: "a", name: "A", body: "1", trigger: ";x" },
      { id: "a", name: "A2", body: "2" },
      { id: "b", name: "B", body: "3", trigger: ";x" },
    ]);
    expect(n.list.map((s) => s.id)).toEqual(["a"]);
    expect(n.skipped.map((s) => s.reason)).toEqual(["duplicate-id", "duplicate-trigger"]);
  });

  it("caps the count and does not read an unbounded list", () => {
    const big = Array.from({ length: SNIPPET_LIMITS.count * 5 }, (_, i) => ({ id: "s" + i, name: "n", body: "b" }));
    const n = normalizeSnippets(big);
    expect(n.list.length).toBe(SNIPPET_LIMITS.count);
    expect(n.skipped.at(-1)!.reason).toBe("too-many");
    expect(n.skipped.length).toBeLessThanOrEqual(SNIPPET_LIMITS.count + 2);
  });

  it("a non-list is one fatal entry", () => {
    expect(normalizeSnippets({}).skipped[0].reason).toBe("bad-json");
  });
});

describe("envelope", () => {
  it("round-trips", () => {
    const list = normalizeSnippets([{ id: "a", name: "A", body: "1", keywords: ["k"] }]).list;
    const text = JSON.stringify(toEnvelope(list));
    expect(JSON.parse(text)).toMatchObject({ format: "advanced-texteditor-md/snippets", version: 1 });
    expect(parseEnvelope(text).list).toEqual(list);
  });
  it("accepts a bare list", () => {
    expect(parseEnvelope('[{"id":"a","name":"A","body":"1"}]').list.length).toBe(1);
  });
  it("is fatal for non-JSON, another version, no list, or a huge text", () => {
    expect(parseEnvelope("{").fatal?.reason).toBe("bad-json");
    expect(parseEnvelope('{"version":2,"snippets":[]}').fatal?.reason).toBe("bad-json");
    expect(parseEnvelope('{"version":1}').fatal?.reason).toBe("bad-json");
    expect(parseEnvelope("1").fatal?.reason).toBe("bad-json");
    expect(parseEnvelope(" ".repeat(SNIPPET_LIMITS.json + 1)).fatal?.reason).toBe("too-large");
    expect(parseEnvelope(5).fatal?.reason).toBe("bad-json");
  });
});
