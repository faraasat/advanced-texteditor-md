import { afterEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "../../src/parser";
import { renderDom, renderHtml } from "../../src/render";
import { commentPattern, commentSyntaxes, createCommentsPlugin, findComments, isCommentId } from "../../src/extensions/comments";
import { MARKDOWN, HTML } from "./vectors";
import { LINEAR_MAX_RATIO, BACKSTOP_MS, measureScaling } from "../helpers/scaling";
import { mount, selectText, type Mounted } from "../plugins/helpers";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  document.querySelectorAll(".atm-comment-thread").forEach((e) => e.remove());
});

const syntax = { inline: commentSyntaxes() };
const rt = (md: string) => stringify(parse(md, { syntax }), { syntax });

function assertSafe(root: Element) {
  for (const e of root.querySelectorAll("*")) {
    for (const a of e.getAttributeNames()) expect(a.toLowerCase().startsWith("on"), `${e.tagName} ${a}`).toBe(false);
    for (const a of ["href", "src", "action", "data"]) expect(e.getAttribute(a) ?? "").not.toMatch(/^\s*(javascript|vbscript|data:text\/html)/i);
    expect(["SCRIPT", "IFRAME", "IMG", "OBJECT", "EMBED"]).not.toContain(e.tagName);
  }
}

describe("comments: hostile input", () => {
  it("hostile ids are not comment marks; the brackets stay text", () => {
    for (const id of ['"><img src=x onerror=alert(1)>', "<script>", "a b", "javascript:alert(1)//x y", "‮rtl", "a\u0000b", "x".repeat(81), "", "c1)(comment:c2"]) {
      const md = `[t](comment:${id})`;
      expect(findComments(md).map((c) => c.id), id).not.toContain(id);
      const host = document.createElement("div");
      host.innerHTML = renderHtml(md, { syntax });
      assertSafe(host);
    }
    expect(isCommentId("__proto__")).toBe(true); // valid characters; only ever used as a Map key / attribute
  });

  it("`javascript:` in a comment-shaped link is never a link, and a comment id is never a URL", () => {
    for (const md of ["[x](javascript:alert(1))", "[x](comment:javascript:alert)", "[x](Comment:c1)", "[x](comment:c1\u0000)", "[[a](javascript:alert(1))](comment:c1)"]) {
      const host = document.createElement("div");
      host.append(renderDom(md, { syntax }));
      assertSafe(host);
      expect(host.querySelector("a[href]")).toBeNull();
    }
  });

  it("the XSS corpus round-trips inside a mark and renders inert", () => {
    for (const v of [...MARKDOWN, ...HTML]) {
      const md = `[${v.replace(/[\\[\]]/g, "\\$&")}](comment:c1)`;
      const once = rt(md);
      expect(rt(once)).toBe(once);
      const host = document.createElement("div");
      host.append(renderDom(once, { syntax }));
      assertSafe(host);
    }
  });

  it("prototype keys as ids pollute nothing", () => {
    const plugin = createCommentsPlugin({ onCreate: () => "__proto__", render: (id) => `T ${id}` });
    plugin.setState("__proto__", "resolved");
    plugin.setState("constructor", "resolved");
    expect(plugin.getState("__proto__")).toBe("resolved");
    expect(plugin.getState("toString")).toBe("open");
    expect(({} as Record<string, unknown>).resolved).toBeUndefined();
    expect(findComments("[a](comment:__proto__) [b](comment:constructor)").map((c) => c.id)).toEqual(["__proto__", "constructor"]);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "id")).toBe(false);
  });

  it("render strings are text, never markup, in the editor and in views", async () => {
    const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
    const plugin = createCommentsPlugin({ onCreate: () => null, render: () => evil });
    m = mount({ value: "[a](comment:c1)", plugins: [plugin] });
    m.surface.focus();
    m.ed.exec("nextComment");
    const p = m.ed.element.querySelector(".atm-comment-thread")!;
    assertSafe(p);
    expect(p.textContent).toContain(evil);
    const host = document.createElement("div");
    document.body.append(host);
    host.append(renderDom("[b](comment:c2)", { syntax: plugin.syntax, postRender: [plugin.postRender!] }));
    host.querySelector<HTMLElement>("mark")!.click();
    const vp = document.body.querySelector(".atm-comment-thread-view")!;
    assertSafe(vp);
    expect(vp.textContent).toContain(evil);
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
    host.remove();
  });

  it("a hostile id from onCreate is refused; the stored Markdown stays unchanged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const id of ['x"><b>', "a)(javascript:alert(1)", "‮abc", "a".repeat(5000)]) {
      const plugin = createCommentsPlugin({ onCreate: () => id });
      m = mount({ value: "one two", plugins: [plugin] });
      m.surface.focus();
      selectText(m.surface, "two");
      expect(await plugin.add(m.ed)).toBeNull();
      expect(m.ed.getValue().trimEnd()).toBe("one two");
      m.destroy();
      m = null;
    }
    warn.mockRestore();
  });

  it("nested and overlapping marks stay well formed; deeper nesting degrades to text, not markup", () => {
    const md = "[[[x](comment:a)](comment:b)](comment:c)";
    const once = rt(md);
    expect(rt(once)).toBe(once);
    const host = document.createElement("div");
    host.append(renderDom(once, { syntax }));
    assertSafe(host);
    expect(host.textContent).toContain("x");
  });

  it("bidi and control characters in the anchored text survive and are text", () => {
    const md = "[a‮b⁦c​d](comment:c1)";
    expect(findComments(md)[0].text).toBe("a‮b⁦c​d");
    expect(rt(md)).toBe(md);
  });

  it("oversized input parses", () => {
    const big = `[${"word ".repeat(40000)}](comment:c1)`;
    expect(findComments(big)).toHaveLength(1);
  });

  it.each([
    ["many unclosed brackets", (n: number) => "[".repeat(n)],
    ["nested pairs without a close", (n: number) => "[a " + "[b](c) ".repeat(n)],
    ["near misses", (n: number) => "[a](comment:c1 ".repeat(n)],
    ["backticks", (n: number) => "[" + "`a ".repeat(n)],
    ["bangs", (n: number) => "![a ".repeat(n)],
    ["escapes", (n: number) => "[" + "\\".repeat(n)],
    ["marks", (n: number) => "[x](comment:c1) ".repeat(n)],
  ])("parsing stays linear: %s", (_name, gen) => {
    const re = new RegExp(commentPattern().source, "g");
    const r = measureScaling((n) => {
      const s = gen(n);
      return () => {
        re.lastIndex = 0;
        while (re.exec(s)) {
          /* scan */
        }
        parse(s, { syntax });
      };
    }, 2000);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
    expect(r.large).toBeLessThan(BACKSTOP_MS);
  });
});
