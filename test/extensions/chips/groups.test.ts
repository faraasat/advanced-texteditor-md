import { describe, expect, it } from "vitest";
import { createGroupMentions, expandGroupMentions } from "../../../src/extensions/chips/groups";
import { renderHtml } from "../../../src/render";
import type { MentionItem } from "../../../src/types";

const sig = { signal: new AbortController().signal };
const people: MentionItem[] = [
  { id: "u1", label: "Ann", kind: "person" },
  { id: "u2", label: "Bob", kind: "person" },
];

describe("createGroupMentions", () => {
  const g = createGroupMentions({
    groups: [
      { id: "channel", label: "channel", description: "Everyone here", members: () => people },
      { id: "team", label: "team", kind: "group", members: async () => [people[0]] },
      { id: "bad", label: "broken", members: () => { throw new Error("x"); } },
    ],
  });

  it("search returns matching groups as kind 'group' items", () => {
    expect(g.search("tea").map((i) => [i.id, i.kind])).toEqual([["team", "group"]]);
    expect(g.search("").map((i) => i.id)).toEqual(["channel", "team", "bad"]);
  });

  it("wrap ranks groups first and drops a duplicate the host also returned", async () => {
    const o = g.wrap({ search: async (q) => [{ id: "team", label: "team", kind: "group" }, ...people.filter((p) => p.label.toLowerCase().includes(q))] });
    const r = await o.search("", sig);
    expect(r.map((i) => i.id)).toEqual(["channel", "team", "bad", "u1", "u2"]);
    const sync = g.wrap({ search: () => people });
    expect((sync.search("b", sig) as MentionItem[]).map((i) => i.id)).toEqual(["bad", "u1", "u2"]);
  });

  it("section: true puts groups under their own heading", () => {
    const s = createGroupMentions({ groups: [{ id: "t", label: "team" }], section: true, labels: { groups: "Teams", others: "Everyone else" } });
    const o = s.wrap({ search: () => people });
    expect(o.groupBy!({ id: "t", label: "team", kind: "group" })).toBe("Teams");
    expect(o.groupBy!(people[0])).toBe("Everyone else");
  });

  it("card lists the members (and survives a throwing members())", async () => {
    const c = await g.card({ type: "chip", scheme: "mention", kind: "group", id: "channel", label: "channel", trigger: "@" });
    expect(c).toEqual({ title: "@channel", subtitle: "Group · 2 members · Everyone here", list: { label: "Members", items: ["Ann", "Bob"] } });
    expect(await g.card({ type: "chip", scheme: "mention", kind: "person", id: "u1", label: "Ann" })).toBeNull();
    expect((await g.card({ type: "chip", scheme: "mention", kind: "group", id: "bad", label: "x" }))!.subtitle).toBe("Group · 0 members");
  });

  it("group chips render with the group class (CSS styles them, no script)", () => {
    const html = renderHtml("[@team](mention:group/team)");
    expect(html).toContain("atm-chip-kind-group");
  });
});

describe("expandGroupMentions", () => {
  it("fans groups out, direct mentions first, each person once with every group in via", async () => {
    const chips = [
      { scheme: "mention", kind: "person", id: "u2", label: "Bob" },
      { scheme: "mention", kind: "group", id: "team", label: "team" },
      { scheme: "mention", kind: "group", id: "all", label: "all" },
    ];
    const members: Record<string, MentionItem[]> = {
      team: [{ id: "u1", label: "Ann", kind: "person", refs: { crm: "1" } }, { id: "u2", label: "Bob", kind: "person" }],
      all: [{ id: "u3", label: "Cy", kind: "person" }, { id: "team", label: "team", kind: "group" }, { id: "all", label: "all", kind: "group" }],
    };
    const out = await expandGroupMentions(chips, async (c) => members[c.id] ?? null);
    expect(out).toEqual([
      { scheme: "mention", kind: "person", id: "u2", label: "Bob", via: ["team"] },
      { scheme: "mention", kind: "person", id: "u1", label: "Ann", attrs: { crm: "1" }, via: ["team"] },
      { scheme: "mention", kind: "person", id: "u3", label: "Cy", via: ["all"] },
    ]);
  });
  it("a resolver that throws or returns junk expands to nothing", async () => {
    const out = await expandGroupMentions([{ scheme: "mention", kind: "group", id: "g", label: "g" }], () => { throw new Error("x"); });
    expect(out).toEqual([]);
    expect(await expandGroupMentions(null as never, () => null)).toEqual([]);
  });
  it("deep and cyclic groups terminate", async () => {
    const out = await expandGroupMentions([{ scheme: "m", kind: "group", id: "g0", label: "g0" }], (c) => {
      const n = Number(c.id.slice(1));
      return [{ id: "g" + (n + 1), label: "g", kind: "group" }, { id: "p" + n, label: "p" }];
    });
    expect(out.length).toBe(9); // depth 0..8
  });
});
