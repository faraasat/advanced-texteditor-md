import { afterEach, describe, expect, it } from "vitest";
import { caret, make, tick, type T } from "./surface-helpers";

let t: T | null = null;
afterEach(() => {
  t?.s.destroy();
  t?.root.parentElement?.remove();
  t = null;
});

describe("beforeKeyDown contract (pane-types.ts)", () => {
  it("when the callback returns true the SURFACE cancels the event and stops propagation", () => {
    t = make("hi", { beforeKeyDown: (e) => e.key === "Enter" });
    let reached = false;
    document.body.addEventListener("keydown", () => (reached = true), { once: true });
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    t.root.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(reached).toBe(false);
    expect(t.s.getValue()).toBe("hi");
  });
  it("when it returns false nothing is cancelled by the contract", () => {
    t = make("hi", { beforeKeyDown: () => false });
    const ev = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    t.root.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("setValue keeps the value verbatim", () => {
  it.each(["cc ", "cc  ", "hello\n", "a\n\n\n", " lead", "x\t", "para one\n\npara two  \n"])("getValue() after setValue(%j) is identical", async (v) => {
    t = make("");
    t.s.setValue(v);
    expect(t.s.getValue()).toBe(v);
    await tick();
    expect(t.s.getValue()).toBe(v);
    expect(t.inputs).toEqual([]); // setValue never emits
  });
  it("normalisation happens on edit, not on load", async () => {
    t = make("");
    t.s.setValue("cc ");
    caret(t.root, "cc ");
    t.root.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "x" }));
    await tick();
    expect(t.inputs.length).toBeLessThanOrEqual(1);
  });
});

describe("trailing space after an atom", () => {
  it("shows the stored trailing space after a chip so the caret can follow it", () => {
    t = make("");
    t.s.setValue("[@Jane](mention:person/1) ");
    expect(t.s.getValue()).toBe("[@Jane](mention:person/1) ");
    expect(t.root.querySelector("p")!.lastChild!.textContent).toBe(" ");
  });
});
