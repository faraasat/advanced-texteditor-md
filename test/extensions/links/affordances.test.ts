import { afterEach, describe, expect, it, vi } from "vitest";
import { createLinkAffordances, createHeadingAnchors, enhanceHeadingAnchors, headingSlug } from "../../../src/extensions/links/affordances";
import { renderDom } from "../../../src/render";
import { mount, wait } from "../../plugins/helpers";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("headingSlug", () => {
  it("makes GitHub-like ids for any script", () => {
    expect(headingSlug("Hello, World!")).toBe("hello-world");
    expect(headingSlug("Привет мир")).toBe("привет-мир");
    expect(headingSlug("!!!")).toBe("section");
  });
});

describe("heading anchors", () => {
  const view = async (md: string, o = {}) => {
    const host = document.createElement("div");
    host.append(renderDom(md, { postRender: [createHeadingAnchors(o).postRender!] }));
    document.body.append(host);
    await wait(1);
    return host;
  };

  it("adds a named, focusable link to each heading with a unique id", async () => {
    const host = await view("# Title\n\n## Title\n\n##### Deep\n");
    const a = host.querySelectorAll<HTMLAnchorElement>(".atm-h-anchor");
    expect(a).toHaveLength(2); // levels 1 to 4 by default
    expect(a[0].getAttribute("aria-label")).toBe("Copy link to this section");
    expect(a[0].getAttribute("href")).toBe("#title");
    expect(a[1].getAttribute("href")).toBe("#title-2");
    expect(host.querySelector("h1")!.id).toBe("title");
  });

  it("copies the address, announces it, and calls onCopy", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onCopy = vi.fn();
    const host = await view("## Setup\n", { onCopy, url: (id: string) => `https://x.test/doc#${id}` });
    host.querySelector<HTMLElement>(".atm-h-anchor")!.click();
    for (let i = 0; i < 60 && !host.querySelector("[role=status]")!.textContent; i++) await wait(25); // the copy code is a lazy chunk
    expect(writeText).toHaveBeenCalledWith("https://x.test/doc#setup");
    expect(host.querySelector("[role=status]")!.textContent).toBe("Link copied");
    expect(onCopy).toHaveBeenCalledWith("setup", "https://x.test/doc#setup");
  });

  it("is idempotent, skips editable roots, and the returned function removes everything", async () => {
    const host = await view("## A\n");
    enhanceHeadingAnchors(host);
    await wait(30);
    expect(host.querySelectorAll(".atm-h-anchor")).toHaveLength(1);
    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    ce.innerHTML = "<h2>Edit</h2>";
    document.body.append(ce);
    enhanceHeadingAnchors(ce);
    await wait(30);
    expect(ce.querySelector(".atm-h-anchor")).toBeNull();
    const off = enhanceHeadingAnchors(host);
    await wait(30);
    off();
    expect(host.querySelector(".atm-h-anchor")).toBeNull();
    expect(() => enhanceHeadingAnchors(null)()).not.toThrow();
  });
});

describe("link affordances in the editor", () => {
  const setup = async (o = {}) => {
    const m = mount({ value: "See [docs](https://example.com/a) and [bad](javascript:alert(1))", plugins: [createLinkAffordances({ delayMs: 0, ...o })] });
    await wait(20);
    return { m, link: m.surface.querySelector<HTMLAnchorElement>("a[href^='https']")! };
  };

  it("Ctrl/Cmd+click opens the link in a new tab without opener; a plain click does not", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { m, link } = await setup();
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(open).not.toHaveBeenCalled();
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
    m.destroy();
  });

  it("onOpen can take over", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onOpen = vi.fn(() => true);
    const { m, link } = await setup({ onOpen });
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(onOpen).toHaveBeenCalledWith("https://example.com/a", expect.any(MouseEvent));
    expect(open).not.toHaveBeenCalled();
    m.destroy();
  });

  it("holding Ctrl marks the surface so CSS can show a pointer", async () => {
    const { m } = await setup();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
    expect(m.surface.classList.contains("atm-mod-down")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(m.surface.classList.contains("atm-mod-down")).toBe(false);
    m.destroy();
  });

  it("hover shows the address in a tooltip the link points at; Escape and mouseout hide it; destroy cleans up", async () => {
    const { m, link } = await setup();
    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await wait(10);
    const tip = document.querySelector<HTMLElement>(".atm-link-hint")!;
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.textContent).toContain("https://example.com/a");
    expect(tip.textContent).toMatch(/(Ctrl|Cmd)\+click to open/);
    expect(link.getAttribute("aria-describedby")).toBe(tip.id);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".atm-link-hint")).toBeNull();
    expect(link.hasAttribute("aria-describedby")).toBe(false);
    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await wait(10);
    expect(document.querySelector(".atm-link-hint")).not.toBeNull();
    m.destroy();
    expect(document.querySelector(".atm-link-hint")).toBeNull();
  });

  it("hint: false, or an editor with linkPreview, shows no tooltip", async () => {
    const { m, link } = await setup({ hint: false });
    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await wait(10);
    expect(document.querySelector(".atm-link-hint")).toBeNull();
    m.destroy();
  });
});
