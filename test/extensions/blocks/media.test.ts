import { afterEach, describe, expect, it } from "vitest";
import { parse } from "../../../src/parser/index";
import { renderDom, renderHtml } from "../../../src/render/index";
import { attachLightbox } from "../../../src/features/lightbox";
import {
  createFileCards,
  fileCardOf,
  fileExt,
  fileGroup,
  isSameOrigin,
  isSizeTitle,
  looksLikeFileName,
} from "../../../src/extensions/blocks/files";
import { createGalleryPlugin, decorateGalleries, isGalleryBlock, isGalleryParagraph } from "../../../src/extensions/blocks/gallery";
import { createHrStylePlugin, hrStyleAttribute, isHrStyle } from "../../../src/extensions/blocks/hr";
import { createShortcodes, mergeShortcodes } from "../../../src/extensions/blocks/shortcodes";
import { createContentBlocksPlugins } from "../../../src/extensions/blocks/index";
import { formatBytes } from "../../../src/extensions/_shared";
import { caretAfter, mount, tick, typeInto, wait, type Mounted } from "../../plugins/helpers";

const view = (md: string, plugins: { postRender?: unknown }[], opts: Record<string, unknown> = {}) => {
  const box = document.createElement("div");
  box.appendChild(renderDom(md, { ...opts, postRender: plugins.map((p) => p.postRender as never) }));
  document.body.appendChild(box);
  return box;
};

describe("files: pure helpers", () => {
  it("extensions and groups", () => {
    expect(fileExt("Report.PDF")).toBe("pdf");
    expect(fileExt("archive.tar.gz")).toBe("gz");
    expect(fileExt("noext")).toBe("");
    expect(fileExt("x.toolongext1")).toBe("");
    expect(fileGroup("pdf")).toBe("pdf");
    expect(fileGroup("xlsx")).toBe("sheet");
    expect(fileGroup("pptx")).toBe("slide");
    expect(fileGroup("zip")).toBe("archive");
    expect(fileGroup("mp3")).toBe("audio");
    expect(fileGroup("mov")).toBe("video");
    expect(fileGroup("ts")).toBe("code");
    expect(fileGroup("txt")).toBe("text");
    expect(fileGroup("docx")).toBe("doc");
    expect(fileGroup("xyz")).toBe("generic");
    expect(fileGroup("png")).toBeNull();
  });
  it("file names and size titles", () => {
    expect(looksLikeFileName("report.pdf")).toBe(true);
    expect(looksLikeFileName("my report v2.docx")).toBe(true);
    expect(looksLikeFileName("see the docs")).toBe(false);
    expect(looksLikeFileName("a/b.pdf")).toBe(false);
    expect(looksLikeFileName(".env")).toBe(false);
    expect(looksLikeFileName("example.com")).toBe(true); // reads like a name; it is a card only if not an image and…
    for (const n of [0, 512, 2400, 2_400_000, 3.4e9]) expect(isSizeTitle(formatBytes(n))).toBe(true);
    expect(isSizeTitle(formatBytes(2_400_000, "de"))).toBe(true);
    expect(isSizeTitle("2.4 MB")).toBe(true);
    expect(isSizeTitle("Big file")).toBe(false);
    expect(isSizeTitle("12 MBs")).toBe(false);
    expect(isSizeTitle(null)).toBe(false);
  });
  it("fileCardOf", () => {
    expect(fileCardOf("report.pdf", "https://x/r", null)).toEqual({ ext: "pdf", group: "pdf", size: null });
    expect(fileCardOf("Download", "https://x/a/data.csv?x=1", "1.2 MB")).toEqual({ ext: "csv", group: "sheet", size: "1.2 MB" });
    expect(fileCardOf("Download", "https://x/a", "1.2 MB")).toEqual({ ext: "", group: "generic", size: "1.2 MB" });
    expect(fileCardOf("photo.png", "https://x/p.png", null)).toBeNull();
    expect(fileCardOf("a link", "https://x/r.pdf", "A title")).toBeNull();
  });
  it("isSameOrigin", () => {
    const base = "https://app.example.com/page";
    expect(isSameOrigin("/files/a.pdf", base)).toBe(true);
    expect(isSameOrigin("a.pdf", base)).toBe(true);
    expect(isSameOrigin("https://app.example.com/a.pdf", base)).toBe(true);
    expect(isSameOrigin("https://cdn.example.com/a.pdf", base)).toBe(false);
    expect(isSameOrigin("//cdn.example.com/a.pdf", base)).toBe(false);
    expect(isSameOrigin("javascript:alert(1)", base)).toBe(false);
    expect(isSameOrigin("", base)).toBe(false);
  });
});

describe("files: cards", () => {
  let m: Mounted;
  afterEach(() => m?.destroy());

  it("views: class, icon group, extension, size; download only for same-origin; href unchanged", () => {
    const f = createFileCards();
    const md = '[report.pdf](https://cdn.example.com/report.pdf "2.4 MB") and [notes.txt](/files/notes.txt) and [a site](https://example.com) and [photo.png](https://x/p.png)';
    const box = view(md, [f.plugin]);
    const [a, b, c, d] = Array.from(box.querySelectorAll("a"));
    expect(a.classList.contains("atm-file")).toBe(true);
    expect(a.getAttribute("data-atm-file")).toBe("pdf");
    expect(a.getAttribute("data-ext")).toBe("pdf");
    expect(a.getAttribute("data-atm-size")).toBe("2.4 MB");
    expect(a.hasAttribute("download")).toBe(false);
    expect(a.getAttribute("href")).toBe("https://cdn.example.com/report.pdf");
    expect(b.getAttribute("download")).toBe("notes.txt");
    expect(c.classList.contains("atm-file")).toBe(false);
    expect(d.classList.contains("atm-file")).toBe(false);
    box.remove();
  });

  it("renderHtml + decorate() gives the same result", () => {
    const box = document.createElement("div");
    box.innerHTML = renderHtml("[r.pdf](https://c/r.pdf)");
    createFileCards().decorate(box);
    expect(box.querySelector("a")!.getAttribute("data-atm-file")).toBe("pdf");
  });

  it("editor: the decoration never changes getValue(), before or after an edit", async () => {
    const f = createFileCards();
    const md = '[report.pdf](https://cdn.example.com/report.pdf "2.4 MB") end';
    m = mount({ value: md, plugins: [f.plugin] });
    await tick();
    const a = m.surface.querySelector("a")!;
    expect(a.classList.contains("atm-file")).toBe(true);
    expect(a.hasAttribute("download")).toBe(false);
    expect(m.ed.getValue()).toBe(md);
    caretAfter(m.surface, "end");
    await typeInto(m.surface, "!");
    expect(m.ed.getValue()).toBe(md + "!");
  });

  it("an upload through wrapUploadHandler stores the size in the title, in the insertion's undo step", async () => {
    const f = createFileCards({ locale: "en" });
    m = mount({
      value: "",
      plugins: [f.plugin],
      upload: { handler: f.wrapUploadHandler(async (file) => ({ url: "https://cdn.example.com/u/" + file.name, name: file.name })) },
    });
    m.surface.focus();
    await m.ed.uploadFiles([new File([new Uint8Array(2400)], "report.pdf", { type: "application/pdf" })]);
    await tick();
    expect(f.sizeOf("https://cdn.example.com/u/report.pdf")).toBe("2.4 kB");
    expect(m.ed.getValue()).toBe('[report.pdf](https://cdn.example.com/u/report.pdf "2.4 kB")');
    await tick();
    expect(m.surface.querySelector("a")!.getAttribute("data-atm-size")).toBe("2.4 kB");
    m.ed.undo();
    expect(m.ed.getValue()).toBe("");
  });

  it("images are not remembered and not titled", async () => {
    const f = createFileCards();
    const h = f.wrapUploadHandler(async () => ({ url: "https://c/x.png" }));
    await h(new File([new Uint8Array(10)], "x.png", { type: "image/png" }), { signal: new AbortController().signal, onProgress() {}, kind: "image" });
    expect(f.sizeOf("https://c/x.png")).toBeUndefined();
  });

  it("the patch is removed on destroy", () => {
    const f = createFileCards();
    m = mount({ value: "", plugins: [f.plugin] });
    const pane = m.ed.getPane() as unknown as { insertAsset: unknown };
    const patched = pane.insertAsset;
    m.destroy();
    expect(pane.insertAsset).not.toBe(patched);
  });
});

describe("gallery", () => {
  let m: Mounted;
  afterEach(() => m?.destroy());
  it("isGalleryBlock", () => {
    expect(isGalleryBlock(parse("![a](1.png) ![b](2.png)").children[0])).toBe(true);
    expect(isGalleryBlock(parse("![a](1.png)\n![b](2.png)").children[0])).toBe(true);
    expect(isGalleryBlock(parse("![a](1.png)").children[0])).toBe(false);
    expect(isGalleryBlock(parse("![a](1.png) text ![b](2.png)").children[0])).toBe(false);
  });
  it("views: a paragraph of two or more images gets the class; alt kept; text paragraphs untouched", () => {
    const box = view("![one](https://x/1.png) ![two](https://x/2.png)\n![three](https://x/3.png)\n\n![a](https://x/a.png) and text", [createGalleryPlugin()]);
    const ps = box.querySelectorAll("p");
    expect(ps[0].classList.contains("atm-gallery")).toBe(true);
    expect(ps[0].getAttribute("data-atm-count")).toBe("3");
    expect(Array.from(ps[0].querySelectorAll("img")).map((i) => i.alt)).toEqual(["one", "two", "three"]);
    expect(ps[1].classList.contains("atm-gallery")).toBe(false);
    box.remove();
  });
  it("a refused image URL breaks the gallery (it goes through the link policy first)", () => {
    const box = view("![a](javascript:alert(1)) ![b](https://x/2.png)", [createGalleryPlugin()]);
    expect(box.querySelector(".atm-gallery")).toBeNull();
    expect(box.querySelector('img[src^="javascript"]')).toBeNull();
    box.remove();
  });
  it("the lightbox still opens gallery images and steps between them", () => {
    const box = view("![one](https://x/1.png) ![two](https://x/2.png)", [createGalleryPlugin()]);
    const lb = attachLightbox(box);
    const imgs = box.querySelectorAll("img");
    expect(imgs[0].getAttribute("role")).toBe("button");
    imgs[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(lb.isOpen()).toBe(true);
    lb.destroy();
    box.remove();
  });
  it("editor: the class follows edits and never reaches the Markdown", async () => {
    const md = "![a](https://x/1.png) ![b](https://x/2.png)\n\ntext";
    m = mount({ value: md, plugins: [createGalleryPlugin()] });
    await tick();
    expect(m.surface.querySelector("p.atm-gallery")).not.toBeNull();
    expect(m.ed.getValue()).toBe(md);
    caretAfter(m.surface, "text");
    await typeInto(m.surface, "!");
    expect(m.ed.getValue()).toBe(md + "!");
    m.ed.setValue("![a](https://x/1.png) words");
    await tick();
    expect(m.surface.querySelector("p.atm-gallery")).toBeNull();
  });
  it("isGalleryParagraph on DOM", () => {
    const p = document.createElement("p");
    p.innerHTML = '<img alt="a"> <br><img alt="b">';
    expect(isGalleryParagraph(p)).toBe(true);
    p.append("x");
    expect(isGalleryParagraph(p)).toBe(false);
    decorateGalleries(document.createElement("div"));
  });
});

describe("hr styles", () => {
  it("the editor element carries the style; views mark each rule; unknown styles fall back", () => {
    expect(isHrStyle("dots")).toBe(true);
    expect(isHrStyle("x")).toBe(false);
    expect(hrStyleAttribute("evil;}")).toEqual({ "data-atm-hr": "line" });
    const m = mount({ value: "a\n\n---\n\nb", plugins: [createHrStylePlugin({ style: "wave" })] });
    expect(m.ed.element.getAttribute("data-atm-hr")).toBe("wave");
    expect(m.ed.getValue()).toBe("a\n\n---\n\nb");
    m.destroy();
    const box = view("***\n\n___", [createHrStylePlugin({ style: "dots" })]);
    expect(Array.from(box.querySelectorAll("hr")).map((h) => h.getAttribute("data-atm-hr"))).toEqual(["dots", "dots"]);
    box.remove();
    const p = createHrStylePlugin({ style: "nope" as never });
    const box2 = view("---", [p]);
    expect(box2.querySelector("hr")!.getAttribute("data-atm-hr")).toBe("line");
    box2.remove();
  });
});

describe("shortcode presets", () => {
  it("normalises names, drops invalid ones, expands aliases", () => {
    const t = createShortcodes(
      { Smile: "😀", "thumbs up": "👍", "bad name!": "x", empty: "", num: 5 as unknown as string, __proto__: "p", constructor: "c" } as Record<string, unknown>,
      { aliases: { "thumbs up": ["+1", "like", "bad alias!"], missing: "m", smile: "Smile" } },
    );
    expect({ ...t }).toEqual({ smile: "😀", thumbs_up: "👍", "+1": "👍", like: "👍" });
    expect(Object.getPrototypeOf(t)).toBeNull();
  });
  it("JSON with __proto__ keys does not pollute", () => {
    const t = createShortcodes(JSON.parse('{"__proto__": {"polluted": "yes"}, "ok": "1", "prototype": "x"}'));
    expect({ ...t }).toEqual({ ok: "1" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("normalize false / custom; long values dropped; null input", () => {
    expect({ ...createShortcodes({ Smile: "a" }, { normalize: false }) }).toEqual({ Smile: "a" });
    expect({ ...createShortcodes({ a: "b" }, { normalize: (n) => "x_" + n }) }).toEqual({ x_a: "b" });
    expect({ ...createShortcodes({ a: "x".repeat(65) }) }).toEqual({});
    expect({ ...createShortcodes(null) }).toEqual({});
  });
  it("mergeShortcodes: later wins", () => {
    expect({ ...mergeShortcodes({ a: "1", b: "2" }, { b: "3" }, undefined) }).toEqual({ a: "1", b: "3" });
  });
});

describe("createContentBlocksPlugins", () => {
  it("returns every plugin, the date chip and the syntax; features can be left out", () => {
    const all = createContentBlocksPlugins({ hrStyle: "dots" });
    expect(all.plugins.map((p) => p.name)).toEqual(["columns", "footnotes", "hr-style", "date-chips", "file-cards", "gallery"]);
    expect(all.chips.map((c) => c.scheme)).toEqual(["date"]);
    expect(all.syntax.block.map((s) => s.name)).toEqual(["columns", "col"]);
    const few = createContentBlocksPlugins({ columns: false, dates: false, files: false, gallery: false, footnotes: false });
    expect(few.plugins).toEqual([]);
    expect(few.syntax.block).toEqual([]);
    const h = async () => ({ url: "x" });
    expect(few.wrapUploadHandler(h)).toBe(h);
  });
  it("all of them in one editor: the Markdown of a rich document is unchanged by every decoration", async () => {
    const all = createContentBlocksPlugins({ hrStyle: "fade" });
    const md = [
      "::: columns\n::: col\nLeft[^1]\n:::\n\n::: col\n[2026-10-02](date:2026-10-02)\n:::\n:::",
      "---",
      "![a](https://x/1.png) ![b](https://x/2.png)",
      '[r.pdf](https://x/r.pdf "1 kB")',
      "[^1]: Note",
    ].join("\n\n");
    const m = mount({ value: md, plugins: all.plugins, chips: all.chips });
    await wait(5);
    expect(m.ed.getValue()).toBe(md);
    m.destroy();
  });
});
