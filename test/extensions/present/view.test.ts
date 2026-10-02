import { afterEach, describe, expect, it, vi } from "vitest";
import { createPresentView, type PresentView } from "../../../src/extensions/present";

const MD = "# Welcome\n\nIntro text\n\n::: notes\nSecret remark one\n:::\n\n---\n\n## Second\n\n```js\nconst a = 1;\n```\n\n::: notes\nSecond slide notes\n:::\n\n---\n\n## Third\n\n- a\n- b\n";

let views: PresentView[] = [];
const make = (md = MD, o: Parameters<typeof createPresentView>[2] = {}) => {
  const v = createPresentView(document.body, md, o);
  views.push(v);
  return v;
};
afterEach(() => {
  views.forEach((v) => v.destroy());
  views = [];
  document.body.textContent = "";
  history.replaceState(null, "", "#");
});
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
const slides = (v: PresentView) => Array.from(v.element.querySelectorAll<HTMLElement>("section.atm-present-slide"));
const visible = (v: PresentView) => slides(v).filter((s) => !s.hidden);
const counter = (v: PresentView) => v.element.querySelector(".atm-present-counter")!;

describe("createPresentView structure", () => {
  it("renders one section per slide, named, with only the first one shown", () => {
    const v = make();
    expect(v.element.parentElement).toBe(document.body);
    expect(slides(v)).toHaveLength(3);
    expect(slides(v).map((s) => s.getAttribute("aria-roledescription"))).toEqual(["slide", "slide", "slide"]);
    expect(slides(v)[0].getAttribute("aria-label")).toBe("Slide 1 of 3: Welcome");
    expect(visible(v)).toEqual([slides(v)[0]]);
    expect(slides(v)[1].hasAttribute("inert")).toBe(true);
    expect(v.element.querySelector("pre code")).not.toBeNull();
  });
  it("keeps notes out of the audience DOM and shows them only in the speaker panel", () => {
    const v = make();
    expect(v.element.textContent).not.toContain("Secret remark");
    key(v.element, "s");
    expect(v.isPresenter()).toBe(true);
    const panel = v.element.querySelector(".atm-present-panel")!;
    expect(panel.textContent).toContain("Secret remark one");
    expect(panel.textContent).toContain("Second");
    expect(slides(v).map((s) => s.textContent).join("")).not.toContain("Secret remark");
    key(v.element, "ArrowRight");
    expect(panel.textContent).toContain("Second slide notes");
    expect(panel.textContent).not.toContain("Secret remark one");
    key(v.element, "s");
    expect(v.element.querySelector(".atm-present-panel")).toBeNull();
    expect(v.element.textContent).not.toContain("notes");
  });
  it("opens the speaker panel from the option and has a running timer", () => {
    vi.useFakeTimers();
    try {
      const v = make(MD, { presenter: true });
      const t = v.element.querySelector(".atm-present-time")!;
      expect(t.textContent).toBe("00:00");
      vi.advanceTimersByTime(3000);
      expect(t.textContent).toBe("00:03");
    } finally {
      vi.useRealTimers();
    }
  });
  it("splits by the option", () => {
    expect(slides(make("# A\n\nx\n\n# B\n\ny\n", { split: "h1" }))).toHaveLength(2);
    expect(slides(make("# A\n\nx\n\n# B\n\ny\n"))).toHaveLength(1);
  });
});

describe("navigation", () => {
  it("next and previous keys", () => {
    const v = make();
    for (const k of ["ArrowRight", "PageDown", " ", "Enter"]) {
      v.goTo(0);
      key(v.element, k);
      expect(v.getIndex(), k).toBe(1);
    }
    for (const [k, init] of [["ArrowLeft", {}], ["PageUp", {}], [" ", { shiftKey: true }]] as [string, KeyboardEventInit][]) {
      v.goTo(2);
      key(v.element, k, init);
      expect(v.getIndex(), k).toBe(1);
    }
    key(v.element, "End");
    expect(v.getIndex()).toBe(2);
    key(v.element, "ArrowRight");
    expect(v.getIndex()).toBe(2);
    key(v.element, "Home");
    expect(v.getIndex()).toBe(0);
  });
  it("number then Enter jumps; Enter alone goes on", () => {
    const v = make();
    key(v.element, "3");
    expect(v.getIndex()).toBe(0);
    key(v.element, "Enter");
    expect(v.getIndex()).toBe(2);
    key(v.element, "9");
    key(v.element, "Enter");
    expect(v.getIndex()).toBe(2);
    v.goTo(0);
    key(v.element, "Enter");
    expect(v.getIndex()).toBe(1);
  });
  it("in a right-to-left container ArrowLeft is next", () => {
    const host = document.createElement("div");
    host.dir = "rtl";
    document.body.append(host);
    const v = createPresentView(host, MD);
    views.push(v);
    key(v.element, "ArrowLeft");
    expect(v.getIndex()).toBe(1);
    key(v.element, "ArrowRight");
    expect(v.getIndex()).toBe(0);
    expect(createPresentView(document.body, MD, { dir: "rtl" }).element.getAttribute("dir")).toBe("rtl");
  });
  it("does not take Space or Enter from a focused button", () => {
    const v = make();
    const btn = v.element.querySelector<HTMLElement>(".atm-present-next")!;
    key(btn, " ");
    key(btn, "Enter");
    expect(v.getIndex()).toBe(0);
    key(btn, "ArrowRight");
    expect(v.getIndex()).toBe(1);
  });
  it("ignores keys with Ctrl, Alt or Meta", () => {
    const v = make();
    key(v.element, "ArrowRight", { ctrlKey: true });
    key(v.element, "ArrowRight", { metaKey: true });
    expect(v.getIndex()).toBe(0);
  });
  it("buttons, edge clicks and swipe", () => {
    const v = make();
    v.element.querySelector<HTMLElement>(".atm-present-next")!.click();
    expect(v.getIndex()).toBe(1);
    v.element.querySelector<HTMLElement>(".atm-present-prev")!.click();
    expect(v.getIndex()).toBe(0);
    const stage = v.element.querySelector<HTMLElement>(".atm-present-stage")!;
    stage.getBoundingClientRect = () => ({ left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON() {} });
    stage.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 980, clientY: 100 }));
    expect(v.getIndex()).toBe(1);
    stage.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 100 }));
    expect(v.getIndex()).toBe(0);
    stage.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 500, clientY: 100 }));
    expect(v.getIndex()).toBe(0);
    const ptr = (type: string, x: number, y = 0) => stage.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerType: "touch", clientX: x, clientY: y, pointerId: 1 }));
    ptr("pointerdown", 300);
    ptr("pointerup", 200);
    expect(v.getIndex()).toBe(1);
    ptr("pointerdown", 100);
    ptr("pointerup", 220);
    expect(v.getIndex()).toBe(0);
    ptr("pointerdown", 100, 0);
    ptr("pointerup", 150, 200); // mostly vertical: not a swipe
    expect(v.getIndex()).toBe(0);
  });
});

describe("progress, counter, hash, update", () => {
  it("progress bar and counter follow the slide", () => {
    const v = make();
    const pb = v.element.querySelector(".atm-present-progress")!;
    expect(pb.getAttribute("role")).toBe("progressbar");
    expect([pb.getAttribute("aria-valuemin"), pb.getAttribute("aria-valuenow"), pb.getAttribute("aria-valuemax")]).toEqual(["1", "1", "3"]);
    expect(counter(v).textContent).toBe("1 / 3");
    expect(counter(v).getAttribute("aria-live")).toBe("polite");
    v.next();
    expect(pb.getAttribute("aria-valuenow")).toBe("2");
    expect(pb.getAttribute("aria-valuetext")).toBe("Slide 2 of 3");
    expect(counter(v).textContent).toBe("2 / 3");
  });
  it("hash option reads and writes #slide-n", () => {
    history.replaceState(null, "", "#slide-2");
    const v = make(MD, { hash: true });
    expect(v.getIndex()).toBe(1);
    v.goTo(2);
    expect(location.hash).toBe("#slide-3");
    history.replaceState(null, "", "#slide-1");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(v.getIndex()).toBe(0);
  });
  it("update keeps the position where it can and re-splits", () => {
    const v = make();
    v.goTo(2);
    v.update("one\n\n---\n\ntwo\n");
    expect(slides(v)).toHaveLength(2);
    expect(v.getIndex()).toBe(1);
    v.update("only one slide");
    expect(slides(v)).toHaveLength(1);
    expect(counter(v).textContent).toBe("1 / 1");
  });
  it("accepts a parsed Doc", () => {
    const v = make({ type: "doc", children: [{ type: "paragraph", children: [{ type: "text", value: "From a doc" }] }] } as never);
    expect(v.element.textContent).toContain("From a doc");
  });
  it("onChange is called with the index", () => {
    const fn = vi.fn();
    const v = make(MD, { onChange: fn });
    v.next();
    expect(fn).toHaveBeenLastCalledWith(1, 3);
  });
});

describe("fullscreen and exit", () => {
  it("falls back to a full-window overlay without the Fullscreen API, F toggles, Escape leaves it first", () => {
    const onExit = vi.fn();
    const v = make(MD, { onExit });
    expect(v.isFullscreen()).toBe(false);
    key(v.element, "f");
    expect(v.isFullscreen()).toBe(true);
    expect(v.element.getAttribute("data-fullscreen")).toBe("overlay");
    const btn = v.element.querySelector(".atm-present-fullscreen")!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    key(v.element, "Escape");
    expect(v.isFullscreen()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    key(v.element, "Escape");
    expect(onExit).toHaveBeenCalledTimes(1);
  });
  it("uses the Fullscreen API when it exists", async () => {
    const calls: string[] = [];
    const orig = HTMLElement.prototype.requestFullscreen;
    HTMLElement.prototype.requestFullscreen = function () {
      calls.push("request");
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => this });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    try {
      const v = make();
      v.setFullscreen(true);
      await Promise.resolve();
      expect(calls).toEqual(["request"]);
      expect(v.isFullscreen()).toBe(true);
      expect(v.element.getAttribute("data-fullscreen")).toBe("api");
    } finally {
      HTMLElement.prototype.requestFullscreen = orig;
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
    }
  });
  it("fullscreen: false hides the button and ignores F", () => {
    const v = make(MD, { fullscreen: false });
    expect(v.element.querySelector(".atm-present-fullscreen")).toBeNull();
    key(v.element, "f");
    expect(v.isFullscreen()).toBe(false);
  });
  it("destroy removes the view and its timers", () => {
    const v = make(MD, { presenter: true });
    v.destroy();
    expect(document.querySelector(".atm-present")).toBeNull();
    v.destroy();
  });
});
