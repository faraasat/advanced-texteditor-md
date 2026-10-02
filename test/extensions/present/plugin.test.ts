import { afterEach, describe, expect, it } from "vitest";
import { createPresentPlugin } from "../../../src/extensions/present";
import { createReaderPlugin } from "../../../src/extensions/reader";
import { mount, type Mounted } from "../../plugins/helpers";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  document.body.removeAttribute("style");
});
const MD = "# One\n\ntext\n\n---\n\n## Two\n\nmore\n\n::: notes\nhush\n:::\n";
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("createPresentPlugin", () => {
  it("adds a Present toolbar item and a command that opens a modal dialog from the editor's value", () => {
    m = mount({ value: MD, plugins: [createPresentPlugin()] });
    const p = createPresentPlugin();
    expect(p.toolbar!.map((t) => [t.id, t.label, t.command])).toEqual([["present", "Present", "present"]]);
    const events: string[] = [];
    m.ed.on("plugin:present:open", () => events.push("open"));
    m.ed.on("plugin:present:close", () => events.push("close"));
    expect(m.ed.exec("present")).toBe(true);
    const dlg = document.querySelector<HTMLElement>(".atm-view-modal")!;
    expect(dlg.getAttribute("role")).toBe("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("data-atm-theme")).toBe("light");
    expect(dlg.querySelectorAll("section.atm-present-slide")).toHaveLength(2);
    expect(dlg.textContent).not.toContain("hush");
    expect(document.activeElement).toBe(dlg.querySelector(".atm-present"));
    expect(m.host.hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(m.ed.exec("present")).toBe(true);
    expect(document.querySelectorAll(".atm-view-modal")).toHaveLength(1);
    key(dlg.querySelector(".atm-present")!, "Escape");
    expect(document.querySelector(".atm-view-modal")).toBeNull();
    expect(m.host.hasAttribute("inert")).toBe(false);
    expect(m.ed.element.contains(document.activeElement)).toBe(true);
    expect(events).toEqual(["open", "close"]);
  });
  it("does nothing for an empty document, and arguments override options", () => {
    m = mount({ value: "", plugins: [createPresentPlugin()] });
    expect(m.ed.exec("present")).toBe(false);
    m.ed.setValue("# A\n\nx\n\n# B\n\ny\n");
    expect(m.ed.exec("present", { split: "h1", start: 1 })).toBe(true);
    expect(document.querySelectorAll("section.atm-present-slide")).toHaveLength(2);
    expect(document.querySelector(".atm-present-counter")!.textContent).toBe("2 / 2");
  });
  it("closes with the editor and can drop the toolbar item", () => {
    m = mount({ value: MD, plugins: [createPresentPlugin()] });
    m.ed.exec("present");
    m.destroy();
    m = null;
    expect(document.querySelector(".atm-view-modal")).toBeNull();
    expect(createPresentPlugin({ toolbar: false }).toolbar).toEqual([]);
  });
});

describe("createReaderPlugin", () => {
  it("opens the reader in a modal with a back button that returns to the editor", () => {
    m = mount({ value: "# A\n\nx\n\n## B\n\ny\n", plugins: [createReaderPlugin()] });
    expect(createReaderPlugin().toolbar![0].label).toBe("Reader view");
    expect(m.ed.exec("reader")).toBe(true);
    const dlg = document.querySelector<HTMLElement>(".atm-view-modal")!;
    expect(dlg.querySelector(".atm-reader")!.getAttribute("data-scroll")).toBe("element");
    expect(dlg.querySelectorAll(".atm-reader-outline a")).toHaveLength(2);
    dlg.querySelector<HTMLElement>(".atm-reader-back")!.click();
    expect(document.querySelector(".atm-view-modal")).toBeNull();
    expect(m.ed.element.contains(document.activeElement)).toBe(true);
  });
  it("Escape closes it", () => {
    m = mount({ value: "# A\n\nx\n\n## B\n\ny\n", plugins: [createReaderPlugin()] });
    m.ed.exec("reader");
    key(document.querySelector(".atm-reader")!, "Escape");
    expect(document.querySelector(".atm-view-modal")).toBeNull();
  });
});
