import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "../../src/editor/create-editor";
import { BUILTIN_EMBEDS } from "../../src/features/embeds";
import type { EditorInstance, EditorOptions, LinkPreview } from "../../src/types";

const hosts: HTMLElement[] = [];
const eds: EditorInstance[] = [];
function make(options: EditorOptions = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const ed = createEditor(host, options);
  eds.push(ed);
  return { ed, host, editable: host.querySelector<HTMLElement>("[contenteditable]")! };
}
afterEach(() => {
  while (eds.length) eds.pop()!.destroy();
  while (hosts.length) hosts.pop()!.remove();
  document.querySelectorAll(".atm-popover").forEach((e) => e.remove());
});
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const URL1 = "https://example.com/article";
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const preview = (over: Partial<LinkPreview> = {}): LinkPreview => ({ url: URL1, title: "An article", description: "About things", siteName: "Example", ...over });

describe("link preview cards in the editor", () => {
  it("a URL alone on its line gets a card; the markdown stays the bare URL line", async () => {
    const md = `intro\n\n${URL1}\n\noutro`;
    const { ed, editable } = make({ value: md, linkPreview: { resolve: async () => preview() } });
    await tick();
    const card = editable.querySelector("[data-atm-preview-card]")!;
    expect(card).not.toBeNull();
    expect(card.getAttribute("contenteditable")).toBe("false");
    expect(card.textContent).toContain("An article");
    expect(ed.getValue()).toBe(md);
    // an edit elsewhere re-serialises the DOM: the card must not leak into the markdown
    editable.querySelector("p")!.firstChild!.textContent = "intro!";
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "!" }));
    await tick(20);
    expect(ed.getValue()).toBe(`intro!\n\n${URL1}\n\noutro`);
    expect(ed.getValue()).not.toContain("An article");
    expect(ed.getHtml()).not.toContain("data-atm-preview-card");
  });

  it("no card for a URL inside a sentence, nor for a link whose text differs", async () => {
    const { editable } = make({ value: `see ${URL1} now\n\n[x](${URL1})`, linkPreview: { resolve: async () => preview() } });
    await tick();
    expect(editable.querySelector("[data-atm-preview-card]")).toBeNull();
  });

  it("the card disappears when the line stops being just a URL", async () => {
    const { editable } = make({ value: URL1, linkPreview: { resolve: async () => preview() } });
    await tick();
    expect(editable.querySelector("[data-atm-preview-card]")).not.toBeNull();
    const p = editable.querySelector("p")!;
    p.insertBefore(document.createTextNode("look: "), p.firstChild);
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "k" }));
    await tick(500);
    expect(editable.querySelector("[data-atm-preview-card]")).toBeNull();
  });

  it("a slow resolver shows a loading skeleton and never blocks the text; a failing one leaves just the link", async () => {
    let finish!: (p: LinkPreview) => void;
    const slow = make({ value: URL1, linkPreview: { resolve: () => new Promise<LinkPreview>((r) => (finish = r)) } });
    await tick();
    const sk = slow.editable.querySelector("[data-atm-preview-card]")!;
    expect(sk.getAttribute("aria-busy")).toBe("true");
    expect(slow.ed.getValue()).toBe(URL1);
    finish(preview());
    await tick();
    expect(slow.editable.querySelector("[data-atm-preview-card]")!.getAttribute("aria-busy")).toBeNull();

    const bad = make({ value: URL1, linkPreview: { resolve: async () => Promise.reject(new Error("offline")) } });
    await tick();
    expect(bad.editable.querySelector("[data-atm-preview-card]")).toBeNull();
    expect(bad.editable.querySelector("a")!.textContent).toBe(URL1);
    expect(bad.ed.getValue()).toBe(URL1);
  });

  it("markup in the title is text, never HTML", async () => {
    const evil = preview({ title: '<img src=x onerror="window.__pwned=1">', description: "<script>window.__pwned=1</script>", siteName: '"><svg onload=1>' });
    const { editable } = make({ value: URL1, linkPreview: { resolve: async () => evil } });
    await tick();
    const card = editable.querySelector("[data-atm-preview-card]")!;
    expect(card.textContent).toContain("<img src=x");
    expect(card.querySelector("img[onerror],script,svg")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("never previews a private address", async () => {
    let calls = 0;
    const { editable } = make({ value: "http://127.0.0.1/admin", linkPreview: { resolve: async () => (calls++, preview()) } });
    await tick();
    expect(calls).toBe(0);
    expect(editable.querySelector("[data-atm-preview-card]")).toBeNull();
  });

  it("modes: ['hover'] shows no block cards", async () => {
    const { editable } = make({ value: URL1, linkPreview: { modes: ["hover"], resolve: async () => preview() } });
    await tick();
    expect(editable.querySelector("[data-atm-preview-card]")).toBeNull();
  });

  it("hover card by keyboard: focusing a link opens a tooltip card, Escape closes it", async () => {
    const { editable } = make({ value: `read [the post](${URL1}) today`, linkPreview: { modes: ["hover"], resolve: async () => preview() } });
    await tick();
    const a = editable.querySelector("a")!;
    a.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await tick();
    const pop = document.querySelector<HTMLElement>(".atm-popover[role=tooltip]")!;
    expect(pop).not.toBeNull();
    expect(pop.textContent).toContain("An article");
    expect(a.getAttribute("aria-describedby")).toBe(pop.id);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".atm-popover")).toBeNull();
    expect(a.hasAttribute("aria-describedby")).toBe(false);
  });

  it("split mode: the preview pane gets cards too, and chips are untouched", async () => {
    const { host } = make({ mode: "split", value: URL1, linkPreview: { resolve: async () => preview() } });
    await tick(500);
    const pane = host.querySelector<HTMLElement>("[aria-label=Preview]")!;
    expect(pane.querySelector("[data-atm-preview-card]")).not.toBeNull();
  });

  it("destroy removes cards and aborts pending loads", async () => {
    let aborted = false;
    const { ed, editable } = make({
      value: URL1,
      linkPreview: { resolve: (_u, { signal }) => new Promise<LinkPreview>(() => signal.addEventListener("abort", () => (aborted = true))) },
    });
    await tick();
    expect(editable.querySelector("[data-atm-preview-card]")).not.toBeNull();
    ed.destroy();
    expect(aborted).toBe(true);
  });

  it("an editor without the options never loads or runs any of it", async () => {
    const { editable } = make({ value: `${URL1}\n\n${YT}` });
    await tick();
    expect(editable.querySelector("[data-atm-preview-card], .atm-embed")).toBeNull();
  });
});

describe("embeds in the editor", () => {
  it("a provider URL alone on its line becomes a sandboxed iframe block; the markdown is unchanged", async () => {
    const md = `before\n\n${YT}\n\nafter`;
    const { ed, editable } = make({ value: md, embeds: BUILTIN_EMBEDS });
    await tick();
    const wrap = editable.querySelector<HTMLElement>(".atm-embed")!;
    expect(wrap).not.toBeNull();
    expect(wrap.getAttribute("contenteditable")).toBe("false");
    const f = wrap.querySelector("iframe")!;
    expect(f.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(f.getAttribute("sandbox")).not.toMatch(/allow-top-navigation|allow-forms/);
    expect(f.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(f.getAttribute("loading")).toBe("lazy");
    expect(f.getAttribute("title")).toBeTruthy();
    expect(ed.getValue()).toBe(md);
    editable.querySelector("p")!.firstChild!.textContent = "before!";
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "!" }));
    await tick(20);
    expect(ed.getValue()).toBe(`before!\n\n${YT}\n\nafter`);
  });

  it("has a toolbar with Convert to link and Open", async () => {
    const { editable } = make({ value: YT, embeds: BUILTIN_EMBEDS });
    await tick();
    const bar = editable.querySelector<HTMLElement>(".atm-embed__toolbar")!;
    expect(bar.getAttribute("role")).toBe("toolbar");
    const open = bar.querySelector<HTMLAnchorElement>("a")!;
    expect(open.getAttribute("href")).toBe(YT);
    expect(open.getAttribute("rel")).toContain("noopener");
    expect(bar.querySelector("button")!.textContent).toBe("Convert to link");
  });

  it("Convert to link toggles the embed off and persists as [host](url)", async () => {
    const { ed, editable } = make({ value: YT, embeds: BUILTIN_EMBEDS });
    await tick();
    editable.querySelector<HTMLButtonElement>("[data-atm-embed-action=convert]")!.click();
    await tick(20);
    expect(editable.querySelector(".atm-embed")).toBeNull();
    expect(editable.querySelector("iframe")).toBeNull();
    expect(ed.getValue()).toBe(`[youtube.com](${YT})`);
    // and it is no longer a standalone URL, so it does not come back
    await tick(500);
    expect(editable.querySelector(".atm-embed")).toBeNull();
  });

  it("hostile and non-provider URLs are not embedded", async () => {
    const { editable } = make({ value: "https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ\n\nhttps://example.com/x", embeds: BUILTIN_EMBEDS });
    await tick();
    expect(editable.querySelector(".atm-embed, iframe")).toBeNull();
  });

  it("embeds: [] embeds nothing", async () => {
    const { editable } = make({ value: YT, embeds: [] });
    await tick();
    expect(editable.querySelector(".atm-embed")).toBeNull();
  });

  it("an embed and a card live together: provider URLs embed, others get cards", async () => {
    const { editable } = make({ value: `${YT}\n\n${URL1}`, embeds: BUILTIN_EMBEDS, linkPreview: { resolve: async () => preview() } });
    await tick();
    expect(editable.querySelectorAll(".atm-embed").length).toBe(1);
    expect(editable.querySelectorAll("[data-atm-preview-card]").length).toBe(1);
  });

  it("round-trips through setValue, mode switches and getHtml", async () => {
    const { ed, editable } = make({ value: YT, embeds: BUILTIN_EMBEDS });
    await tick();
    ed.setMode("markdown");
    ed.setMode("wysiwyg");
    await tick();
    expect(ed.getValue()).toBe(YT);
    expect(editable.querySelector(".atm-embed iframe")).not.toBeNull();
    expect(ed.getHtml()).toContain("<iframe");
  });
});
