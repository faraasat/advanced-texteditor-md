import { afterEach, describe, expect, it, vi } from "vitest";
import { createReaderView, type ReaderView } from "../../../src/extensions/reader";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const MD = `# Guide\n\n${words(230)}\n\n## Setup\n\nSome text\n\n### Install\n\nMore\n\n#### Deep\n\nDeep text\n\n## Usage\n\nEnd\n\n::: notes\nPrivate remark\n:::\n`;

let views: ReaderView[] = [];
const make = (md = MD, o: Parameters<typeof createReaderView>[2] = {}) => {
  const v = createReaderView(document.body, md, o);
  views.push(v);
  return v;
};
afterEach(() => {
  views.forEach((v) => v.destroy());
  views = [];
  document.body.textContent = "";
});
const links = (v: ReaderView) => Array.from(v.element.querySelectorAll<HTMLAnchorElement>(".atm-reader-outline a"));
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("createReaderView", () => {
  it("renders an article with a named outline of the headings up to depth 3", () => {
    const v = make();
    expect(v.element.getAttribute("role")).toBe("region");
    expect(v.element.querySelector("article .atm-reader-content h1")!.textContent).toBe("Guide");
    const nav = v.element.querySelector("nav")!;
    expect(nav.getAttribute("aria-label")).toBe("Outline");
    expect(links(v).map((a) => a.textContent)).toEqual(["Guide", "Setup", "Install", "Usage"]);
    const ids = links(v).map((a) => a.getAttribute("href")!.slice(1));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(v.element.querySelector(`#${CSS.escape(id)}`)).not.toBeNull();
    expect(v.outline.map((o) => o.level)).toEqual([1, 2, 3, 2]);
  });
  it("outlineDepth widens or narrows it; fewer than two headings hides the outline", () => {
    expect(links(make(MD, { outlineDepth: 4 })).map((a) => a.textContent)).toContain("Deep");
    const v = make("# Only\n\ntext\n");
    expect(v.element.getAttribute("data-outline")).toBe("none");
    expect(v.element.querySelector(".atm-reader-toggle")).toBeNull();
  });
  it("duplicate headings get distinct ids", () => {
    const v = make("## Same\n\na\n\n## Same\n\nb\n");
    const ids = links(v).map((a) => a.getAttribute("href"));
    expect(ids[0]).not.toBe(ids[1]);
  });
  it("shows the reading time and the word count", () => {
    const v = make(`# T\n\n${words(460)}\n`);
    expect(v.element.querySelector(".atm-reader-time")!.textContent).toBe("2 min read");
    expect(v.element.querySelector(".atm-reader-words")!.textContent).toBe("461 words");
    expect(v.stats.words).toBe(461);
    expect(make("", {}).element.querySelector(".atm-reader-time")!.textContent).toBe("Under 1 min read");
  });
  it("can hide the statistics", () => {
    expect(make(MD, { readingTime: false }).element.querySelector(".atm-reader-meta")).toBeNull();
  });
  it("notes are an aside by default and can be hidden", () => {
    expect(make().element.querySelector(".atm-custom-notes")!.textContent).toContain("Private remark");
    expect(make(MD, { notes: "hide" }).element.textContent).not.toContain("Private remark");
  });
  it("progress bar follows the scroll of the element", () => {
    const v = make(MD, { scroll: "element" });
    const pb = v.element.querySelector(".atm-reader-progress")!;
    expect(pb.getAttribute("role")).toBe("progressbar");
    expect([pb.getAttribute("aria-valuemin"), pb.getAttribute("aria-valuemax")]).toEqual(["0", "100"]);
    const set = (top: number) => {
      Object.defineProperty(v.element, "scrollTop", { configurable: true, value: top });
      Object.defineProperty(v.element, "scrollHeight", { configurable: true, value: 1500 });
      Object.defineProperty(v.element, "clientHeight", { configurable: true, value: 500 });
      v.refresh();
    };
    set(0);
    expect(pb.getAttribute("aria-valuenow")).toBe("0");
    set(500);
    expect(pb.getAttribute("aria-valuenow")).toBe("50");
    expect(pb.getAttribute("aria-valuetext")).toBe("50% read");
    set(1000);
    expect(pb.getAttribute("aria-valuenow")).toBe("100");
    expect(v.getProgress()).toBe(1);
  });
  it("marks the current section with aria-current=location", () => {
    const v = make(MD, { scroll: "element" });
    const heads = links(v).map((a) => v.element.querySelector<HTMLElement>(a.getAttribute("href")!.replace("#", "#"))!);
    const place = (tops: number[]) => heads.forEach((hd, i) => (hd.getBoundingClientRect = () => ({ top: tops[i], bottom: tops[i] + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: tops[i], toJSON() {} })));
    Object.defineProperty(v.element, "scrollHeight", { configurable: true, value: 3000 });
    Object.defineProperty(v.element, "clientHeight", { configurable: true, value: 500 });
    Object.defineProperty(v.element, "scrollTop", { configurable: true, value: 400 });
    place([-300, 10, 700, 900]);
    v.refresh();
    expect(links(v).map((a) => a.getAttribute("aria-current"))).toEqual([null, "location", null, null]);
    expect(v.getCurrent()).toBe(heads[1].id);
    place([-900, -600, -100, 700]);
    v.refresh();
    expect(links(v).map((a) => a.getAttribute("aria-current"))).toEqual([null, null, "location", null]);
  });
  it("the outline toggle opens and closes it", () => {
    const v = make();
    const t = v.element.querySelector<HTMLButtonElement>(".atm-reader-toggle")!;
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(t.getAttribute("aria-controls")).toBe(v.element.querySelector("nav")!.id);
    t.click();
    expect(t.getAttribute("aria-expanded")).toBe("true");
    expect(v.element.hasAttribute("data-outline-open")).toBe(true);
    links(v)[1].click();
    expect(v.element.hasAttribute("data-outline-open")).toBe(false);
  });
  it("clicking an outline entry scrolls to the heading, focuses it and marks it", () => {
    const v = make();
    const target = v.element.querySelector<HTMLElement>(links(v)[2].getAttribute("href")!)!;
    target.scrollIntoView = vi.fn();
    links(v)[2].click();
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
    expect(links(v)[2].getAttribute("aria-current")).toBe("location");
  });
  it("a back button and Escape appear with onExit", () => {
    const onExit = vi.fn();
    const v = make(MD, { onExit });
    v.element.querySelector<HTMLElement>(".atm-reader-back")!.click();
    expect(onExit).toHaveBeenCalledTimes(1);
    key(v.element, "Escape");
    expect(onExit).toHaveBeenCalledTimes(2);
    expect(make().element.querySelector(".atm-reader-back")).toBeNull();
  });
  it("update re-renders and rebuilds the outline", () => {
    const v = make();
    v.update("## A\n\nx\n\n## B\n\ny\n");
    expect(links(v).map((a) => a.textContent)).toEqual(["A", "B"]);
    expect(v.element.textContent).not.toContain("Guide");
  });
  it("heading text is text, never markup", () => {
    const v = make("## <img src=x onerror=alert(1)>\n\ntext\n\n## b\n");
    expect(v.element.querySelector("img")).toBeNull();
    expect(links(v)[0].textContent).toBe("<img src=x onerror=alert(1)>");
  });
});
