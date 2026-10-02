import { describe, expect, it } from "vitest";
import { classifyFile, decodeUtf8, isDroppableDocument, readImportFile, textToMarkdown } from "../../../src/extensions/export/import";
import { createEditor } from "../../../src/editor/create-editor";
import { parse, renderHtml } from "../../../src/index";
import { expectLinear } from "./scaling-helper";

const file = (content: string | Uint8Array, name: string, type = "") => new File([content as BlobPart], name, { type });

describe("classifyFile", () => {
  it("goes by extension, then by type", () => {
    expect(classifyFile("a.md")).toBe("markdown");
    expect(classifyFile("A.MARKDOWN")).toBe("markdown");
    expect(classifyFile("a.txt")).toBe("text");
    expect(classifyFile("a.html")).toBe("html");
    expect(classifyFile("a.HTM")).toBe("html");
    expect(classifyFile("a.docx")).toBeNull();
    expect(classifyFile("a.png", "text/plain")).toBeNull();
    expect(classifyFile("readme", "text/markdown")).toBe("markdown");
    expect(classifyFile("readme", "text/plain;charset=utf-8")).toBe("text");
    expect(classifyFile("readme")).toBeNull();
  });
  it("drops only documents, not html", () => {
    expect(isDroppableDocument("a.md")).toBe(true);
    expect(isDroppableDocument("a.txt")).toBe(true);
    expect(isDroppableDocument("a.html")).toBe(false);
    expect(isDroppableDocument("a.png", "image/png")).toBe(false);
  });
});

describe("textToMarkdown", () => {
  const roundTrip = (text: string) => {
    const html = renderHtml(textToMarkdown(text));
    const d = document.createElement("div");
    d.innerHTML = html;
    return d;
  };
  it("reads back as the same text", () => {
    const samples = ["# not a heading", "- not a list", "1. not a list", "> not a quote", "*a* _b_ `c` [d](http://x.com) <b>e</b> ![i](x.png)", "a & b &amp; c", "$x$ ==y== ~~z~~ ^s^", "| a | b |\n| --- | --- |", "---", "```\ncode\n```", "line one\nline two\n\nnew paragraph", "    indented", "a\\b", "{{x}} :smile: @user #tag"];
    for (const s of samples) {
      const d = roundTrip(s);
      expect(d.querySelectorAll("h1,h2,h3,ul,ol,blockquote,pre,table,hr,strong,em,a,img,code,b").length, s).toBe(0);
      const c = d.cloneNode(true) as HTMLElement;
      c.querySelectorAll("p").forEach((p) => p.append("\n"));
      c.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
      const text = (c.textContent ?? "").replace(/ /g, " ");
      expect(text.replace(/\s+/g, " ").trim()).toBe(s.replace(/\s+/g, " ").trim());
    }
  });
  it("keeps line breaks as breaks and blank lines as paragraphs", () => {
    const d = roundTrip("a\nb\n\nc");
    expect(d.querySelectorAll("p").length).toBe(2);
    expect(d.querySelectorAll("br").length).toBe(1);
  });
  it("is stable through parse and stringify", async () => {
    const { stringify } = await import("../../../src/index");
    const md = textToMarkdown("# a\n- b\n\n*c*");
    expect(stringify(parse(md))).toBe(stringify(parse(stringify(parse(md)))));
  });
  it("is linear", () => {
    expectLinear((n) => () => void textToMarkdown("a *b* #c\n".repeat(n)), 50_000);
  });
});

describe("decodeUtf8", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("strips a BOM and decodes UTF-8", () => {
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("héllo")]))).toBe("héllo");
  });
  it("refuses binary", () => {
    expect(decodeUtf8(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 1]))).toBeNull();
    expect(decodeUtf8(new Uint8Array(Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : 65))))).toBeNull();
  });
});

describe("readImportFile", () => {
  it("reads Markdown as is, CRLF normalised", async () => {
    const r = await readImportFile(file("# T\r\n\r\n**b**\r\n", "a.md"));
    expect(r).toMatchObject({ ok: true, kind: "markdown", markdown: "# T\n\n**b**\n", name: "a.md" });
  });
  it("escapes text", async () => {
    const r = await readImportFile(file("# not\n<b>x</b>", "a.txt"));
    expect(r.ok && r.kind).toBe("text");
    expect(r.ok && r.markdown).toBe("\\# not\\\n\\<b\\>x\\</b\\>");
    expect((await readImportFile(file("# yes", "a.txt"), { txt: "markdown" }))).toMatchObject({ ok: true, markdown: "# yes" });
  });
  it("converts HTML through the converter and the link policy", async () => {
    const r = await readImportFile(file('<h1>Hi</h1><p>x <a href="https://e.com">l</a> <a href="javascript:alert(1)">bad</a><script>window.__xss=1</script></p>', "p.html"));
    expect(r.ok && r.kind).toBe("html");
    const md = r.ok ? r.markdown : "";
    expect(md).toContain("# Hi");
    expect(md).toContain("[l](https://e.com)");
    expect(md).not.toContain("javascript");
    expect(md).not.toContain("script");
    expect(md).not.toContain("__xss");
    expect(await readImportFile(file('<a href="/rel">r</a>', "p.htm"))).toMatchObject({ ok: true });
  });
  it("says why it refused", async () => {
    expect(await readImportFile(file("x", "a.docx"))).toMatchObject({ ok: false, reason: "unsupported" });
    expect(await readImportFile(file("x".repeat(100), "a.md"), { maxBytes: 50 })).toMatchObject({ ok: false, reason: "too-large" });
    expect(await readImportFile(file(new Uint8Array([65, 0, 66]), "a.md"))).toMatchObject({ ok: false, reason: "binary" });
    expect(await readImportFile(file("  \n ", "a.md"))).toMatchObject({ ok: false, reason: "empty" });
    expect(await readImportFile({ name: "a.md", size: 1, arrayBuffer: () => Promise.reject(new Error("x")) })).toMatchObject({ ok: false, reason: "unreadable" });
  });
  it("caps at 2 MB by default and checks the real size too", async () => {
    expect(await readImportFile(file("x".repeat(2 * 1024 * 1024 + 1), "big.md"))).toMatchObject({ ok: false, reason: "too-large" });
    const liar = { name: "a.md", type: "", size: 1, arrayBuffer: async () => new Uint8Array(3000).buffer };
    expect(await readImportFile(liar, { maxBytes: 100 })).toMatchObject({ ok: false, reason: "too-large" });
  });
});

void createEditor;
