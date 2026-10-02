import { afterEach, describe, expect, it } from "vitest";
import { parse } from "../../src/parser";
import { renderDom } from "../../src/render";
import { createSnippets } from "../../src/extensions/snippets/plugin";
import { memorySnippets, localStorageSnippets } from "../../src/extensions/snippets/storage";
import { createSnippetStore } from "../../src/extensions/snippets/store";
import { exportSnippets, importSnippets } from "../../src/extensions/snippets/portability";
import { SNIPPET_LIMITS, normalizeSnippets, validateSnippet } from "../../src/extensions/snippets/model";
import { escapeMarkdownText, expandBody, tokenize } from "../../src/extensions/snippets/variables";
import { filterSnippets } from "../../src/extensions/snippets/search";
import { findTrigger } from "../../src/extensions/snippets/plugin";
import { caretAtEnd, mount, typeInto, wait, type Mounted } from "../plugins/helpers";
import { measureScaling, LINEAR_MAX_RATIO } from "../helpers/scaling";
import type { Snippet } from "../../src/extensions/snippets/model";
import type { InlineNode } from "../../src/types";

/**
 * Hostile data through every door the snippets subpath has: snippet fields from a file, storage or
 * the host; variable values (text, Markdown, async); triggers; the picker's rendering; and the
 * loops over input. After each path the document is checked for script-capable markup.
 */

const X = "window.__xss=1";
const SAFE = new Set(["http", "https", "mailto", "tel"]);
const BANNED = new Set(["SCRIPT", "OBJECT", "EMBED", "BASE", "META", "LINK", "FORM", "IFRAME", "FRAME", "FOREIGNOBJECT", "NOSCRIPT", "STYLE"]);
const badUrl = (raw: string) => {
  // eslint-disable-next-line no-control-regex
  const u = raw.replace(/[\u0000- \u007f-\u009f\u200b-\u200d\ufeff]/g, "").toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(u);
  return !!m && !SAFE.has(m[1]);
};
function unsafe(root: ParentNode = document): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((e) => {
    const tag = e.tagName.toUpperCase();
    if (BANNED.has(tag) && !(tag === "STYLE" && e.hasAttribute("data-atm-plugin"))) out.push(`<${tag.toLowerCase()}>`);
    for (const a of Array.from(e.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) out.push(`${tag}[${n}]`);
      if (["href", "src", "action", "formaction", "xlink:href", "poster", "data"].includes(n) && badUrl(a.value)) out.push(`${tag}[${n}=${a.value.slice(0, 40)}]`);
    }
  });
  if ((window as unknown as { __xss?: unknown }).__xss !== undefined) out.push("window.__xss was set");
  return out;
}

const HOSTILE = [
  `<img src=x onerror="${X}">`,
  `<script>${X}</script>`,
  `[x](javascript:${X})`,
  `![x](javascript:${X})`,
  `<svg onload=${X}>`,
  `javascript:${X}`,
  `\u202egnp.exe\u202c`,
  `\u2066x\u2069`,
  "\u0000\u0001\u0007",
  `$$ \\href{javascript:${X}}{x} $$`,
  "`` ` `` ```\n```",
  `:::note\n${X}\n:::`,
  `[^1]: ${X}`,
  "| a | b |\n|---|---|",
  `<https://example.com> <a@b.co>`,
  `&lt;script&gt; &#60;script&#62;`,
  "{{cursor}}{{selection}}{{date}}",
  "a".repeat(30_000),
  String.fromCharCode(0xfdd0) + "x" + String.fromCharCode(0xfdd0),
];

const open: Mounted[] = [];
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.querySelectorAll(".atm-snip-picker,[data-sec-host]").forEach((e) => e.remove());
  delete (window as unknown as { __xss?: unknown }).__xss;
});

function readBack(md: string): string | null {
  const doc = parse(md);
  if (doc.children.length !== 1 || doc.children[0].type !== "paragraph") return null;
  let out = "";
  for (const n of doc.children[0].children as InlineNode[]) {
    if (n.type === "text") out += n.value;
    else if (n.type === "break") out += "\n";
    else return null;
  }
  return out;
}

describe("security: variable values", () => {
  it("a text value can never form syntax: it reads back as exactly its text", () => {
    for (const h of HOSTILE) {
      const clean = h
        .split("\n")
        .map((l) => l.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069\ufdd0]/g, "").trim())
        .filter(Boolean)
        .join("\n");
      if (!clean) continue;
      const md = escapeMarkdownText(h);
      expect(readBack(md), JSON.stringify(h.slice(0, 60))).toBe(clean);
      const host = document.createElement("div");
      host.setAttribute("data-sec-host", "");
      host.append(renderDom(md));
      document.body.append(host);
      expect(unsafe(host)).toEqual([]);
      expect(host.querySelectorAll("a,img").length).toBe(0);
    }
  });

  it("inserted into a live editor, hostile text values stay text and window.__xss is never set", async () => {
    for (const h of HOSTILE) {
      const sn = createSnippets({
        storage: memorySnippets([{ id: "v", name: "V", trigger: ";v", body: "Value: {{v}} end", scope: "inline" }]),
        variables: { v: () => h },
      });
      const m = mount({ value: "", plugins: [sn.plugin] });
      open.push(m);
      m.surface.focus();
      caretAtEnd(m);
      await typeInto(m.surface, ";v ");
      expect(unsafe(m.surface), JSON.stringify(h.slice(0, 40))).toEqual([]);
      expect(m.surface.querySelectorAll("a,img,script").length).toBe(0);
      expect(m.surface.textContent).not.toContain(String.fromCharCode(0xfdd0));
      m.destroy();
      open.pop();
    }
  });

  it("a value carrying the caret marker cannot move the caret or leave the marker behind", async () => {
    const MARK = String.fromCharCode(0xfdd0);
    const sn = createSnippets({
      storage: memorySnippets([{ id: "v", name: "V", trigger: ";v", body: "A {{v}} B{{cursor}} C", scope: "inline" }]),
      variables: { v: `x${MARK}y` },
    });
    const m = mount({ value: "", plugins: [sn.plugin] });
    open.push(m);
    m.surface.focus();
    caretAtEnd(m);
    await typeInto(m.surface, ";v ");
    await typeInto(m.surface, "Z");
    expect(m.ed.getValue()).toBe("A xy BZ C");
  });

  it("an object, a getter that throws or a symbol is no value", () => {
    const evil = { toString() { throw new Error("no"); } } as unknown as string;
    const sym = Symbol("s") as unknown as string;
    const r = expandBody({
      snippet: { id: "s", name: "s", body: "{{a}}{{b}}{{c}}{{d}}", scope: "inline" },
      selection: "",
      variables: { a: evil, b: sym, c: () => evil, d: () => ({ x: 1 }) as unknown as string },
    });
    expect(r).toEqual({ text: "{{a}}{{b}}{{c}}{{d}}", cursor: null });
  });

  it("a hostile selection is inserted as the Markdown it is, and parsed safely", async () => {
    const sn = createSnippets({ storage: memorySnippets([{ id: "w", name: "W", body: "> {{selection}}", scope: "block" }]) });
    const m = mount({ value: `x`, plugins: [sn.plugin] });
    open.push(m);
    m.surface.focus();
    await sn.insert(m.ed, "w");
    expect(unsafe(m.surface)).toEqual([]);
  });
});

describe("security: snippet bodies", () => {
  it("a body is Markdown parsed under the editor's rules: no script, no javascript: URL", async () => {
    for (const h of HOSTILE) {
      const sn = createSnippets({ storage: memorySnippets([{ id: "b", name: "B", trigger: ";b", body: h.slice(0, 2000) || "x", scope: "block" }]) });
      const m = mount({ value: "", plugins: [sn.plugin] });
      open.push(m);
      m.surface.focus();
      caretAtEnd(m);
      await typeInto(m.surface, ";b ");
      expect(unsafe(m.surface), JSON.stringify(h.slice(0, 40))).toEqual([]);
      const host = document.createElement("div");
      host.setAttribute("data-sec-host", "");
      host.append(renderDom(m.ed.getValue()));
      document.body.append(host);
      expect(unsafe(host)).toEqual([]);
      m.destroy();
      open.pop();
    }
  });
});

describe("security: records from outside", () => {
  it("a stored or imported list is rebuilt field by field", () => {
    const evil = JSON.parse(
      `{"version":1,"snippets":[
        {"id":"ok","name":"Ok","body":"b","__proto__":{"scope":"block","polluted":1},"constructor":{"prototype":{"polluted":1}},"extra":"x"},
        {"id":"__proto__","name":"p","body":"b"},
        {"id":"constructor","name":"c","body":"b"},
        {"id":"a/../b","name":"n","body":"b"},
        {"id":"t","name":"n","body":"b","trigger":"a b"},
        {"id":"u","name":"n","body":"b","trigger":"\\u202esig"},
        {"id":"v","name":"n","body":"b","keywords":[{"toString":1}]},
        {"id":"w","name":["x"],"body":"b"},
        {"id":"x","name":"n","body":{"y":1}}
      ]}`,
    );
    const n = normalizeSnippets(evil.snippets);
    expect(n.list.map((s) => s.id)).toEqual(["ok"]);
    expect(Object.keys(n.list[0]).sort()).toEqual(["body", "id", "name", "scope"]);
    expect(n.list[0].scope).toBe("inline");
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(n.skipped.length).toBe(8);
  });

  it("localStorage content that is not ours changes nothing and throws nothing", () => {
    const a = localStorageSnippets("sec1");
    for (const raw of ["null", "[]", "{}", '{"version":1,"snippets":"x"}', "\u0000", "{".repeat(100_000), JSON.stringify({ version: 1, snippets: [1, null, "x", []] })]) {
      localStorage.setItem("sec1", raw);
      expect(() => a.load()).not.toThrow();
      const l = a.load();
      expect(l === null || Array.isArray(l)).toBe(true);
    }
    localStorage.setItem("sec1", "x".repeat(SNIPPET_LIMITS.json + 1));
    expect(a.load()).toBeNull();
  });

  it("an oversized import is refused as a whole, and replace never empties the store", async () => {
    const st = createSnippetStore({ storage: false, defaults: [{ id: "a", name: "A", body: "b", scope: "inline" }] });
    const r = await importSnippets(" ".repeat(SNIPPET_LIMITS.json + 1), { mode: "replace", store: st });
    expect(r.applied).toBe(false);
    expect(r.skipped[0].reason).toBe("too-large");
    expect(st.list().length).toBe(1);
    const big = JSON.stringify({ version: 1, snippets: Array.from({ length: 50_000 }, (_, i) => ({ id: "s" + i, name: "n", body: "b" })) });
    const r2 = await importSnippets(big, { store: createSnippetStore({ storage: false }) });
    expect(r2.list.length).toBe(SNIPPET_LIMITS.count);
    expect(r2.skipped.some((s) => s.reason === "too-many")).toBe(true);
  });

  it("control and bidi characters never reach a name, a body or a trigger", () => {
    const v = validateSnippet({ id: "a", name: "N\u202eame\u0000", body: "b\u2066o\u2069dy\u0007", trigger: ";ok" });
    expect(v.ok && v.snippet.name).toBe("Name");
    expect(v.ok && v.snippet.body).toBe("body");
    expect(validateSnippet({ id: "a", name: "n", body: "b", trigger: "\u202esig" }).ok).toBe(false);
    expect(validateSnippet({ id: "a", name: "n", body: "b", trigger: "\u200bsig" }).ok).toBe(false);
  });

  it("export then import is a fixed point even for hostile content", async () => {
    const list: Snippet[] = HOSTILE.slice(0, 12).map((h, i) => ({ id: "h" + i, name: "n" + i, body: h.slice(0, 500) || "x", scope: "inline" as const }));
    const a = createSnippetStore({ storage: false });
    await a.replaceAll(list);
    const json = exportSnippets(a);
    const b = createSnippetStore({ storage: false });
    await importSnippets(json, { store: b });
    expect(exportSnippets(b)).toBe(json);
  });
});

describe("security: picker rendering", () => {
  it("names, triggers, descriptions and bodies are text", async () => {
    const list: Snippet[] = HOSTILE.slice(0, 8).map((h, i) => ({ id: "h" + i, name: h.slice(0, 100) || "n", trigger: ";h" + i, body: h.slice(0, 400) || "b", scope: "inline", description: h.slice(0, 200) }));
    const sn = createSnippets({ storage: memorySnippets(list) });
    const m = mount({ value: "", plugins: [sn.plugin] });
    open.push(m);
    m.surface.focus();
    m.ed.exec("plugin:snippets:picker");
    const dlg = await (async () => {
      for (let i = 0; i < 200; i++) {
        const d = document.querySelector<HTMLElement>(".atm-snip-picker");
        if (d) return d;
        await wait(5);
      }
      throw new Error("no dialog");
    })();
    expect(unsafe(dlg)).toEqual([]);
    expect(dlg.querySelectorAll("img,svg,script,a,b").length).toBe(0);
  });
});

describe("security: loops over input are linear", () => {
  it("tokenize and expandBody", () => {
    const r = measureScaling((n) => {
      const body = "{{a:".repeat(n) + "{{x}}".repeat(Math.min(n, 100)) + "{{ ".repeat(n);
      return () => void expandBody({ snippet: { id: "s", name: "s", body, scope: "inline" }, selection: "", variables: { x: "1" } });
    }, 5000);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
    const t = measureScaling((n) => {
      const body = "{{".repeat(n);
      return () => void tokenize(body);
    }, 5000);
    expect(t.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("escapeMarkdownText", () => {
    const r = measureScaling((n) => {
      const s = "\\[](<&_$|`*~http://www.!".repeat(n);
      return () => void escapeMarkdownText(s, ["=="]);
    }, 2000);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("findTrigger and filterSnippets", () => {
    const lookup = () => undefined;
    const f = measureScaling((n) => {
      const s = "x".repeat(n);
      return () => void findTrigger(s, lookup);
    }, 20_000);
    expect(f.ratio).toBeLessThan(LINEAR_MAX_RATIO);
    const list: Snippet[] = Array.from({ length: 1000 }, (_, i) => ({ id: "s" + i, name: "name " + i, body: "b", scope: "inline" }));
    const q = measureScaling((n) => {
      const query = "na ".repeat(n);
      return () => void filterSnippets(list, query);
    }, 500);
    expect(q.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("validation of huge fields is rejected without scanning them all", () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) validateSnippet({ id: "a", name: "n", body: "x".repeat(5_000_000) });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
