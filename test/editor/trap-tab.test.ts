import { describe, expect, it } from "vitest";
import { trapTab } from "../../src/editor/dom";

/** Focus is moved by trapTab itself on every Tab, not only at the edges: Safari's default Tab order skips buttons. */
describe("trapTab", () => {
  const setup = () => {
    const root = document.createElement("div");
    root.innerHTML = '<button id="a">a</button><button id="b">b</button><input id="c"><button id="d" disabled>d</button>';
    document.body.appendChild(root);
    const press = (shiftKey = false) => {
      const ev = new KeyboardEvent("keydown", { key: "Tab", shiftKey, cancelable: true });
      trapTab(root, ev);
      return { prevented: ev.defaultPrevented, id: (document.activeElement as HTMLElement).id };
    };
    return { root, press };
  };
  it("moves to the next focusable from the middle, wraps at the end, skips disabled", () => {
    const { root, press } = setup();
    (root.querySelector("#a") as HTMLElement).focus();
    expect(press()).toEqual({ prevented: true, id: "b" });
    expect(press()).toEqual({ prevented: true, id: "c" });
    expect(press()).toEqual({ prevented: true, id: "a" });
    root.remove();
  });
  it("Shift+Tab goes backwards and wraps; from outside it enters at the right end", () => {
    const { root, press } = setup();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(press(true)).toEqual({ prevented: true, id: "c" });
    expect(press(true)).toEqual({ prevented: true, id: "b" });
    (root.querySelector("#a") as HTMLElement).focus();
    expect(press(true)).toEqual({ prevented: true, id: "c" });
    root.remove();
  });
  it("other keys are left alone", () => {
    const { root } = setup();
    const ev = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    trapTab(root, ev);
    expect(ev.defaultPrevented).toBe(false);
    root.remove();
  });
});
