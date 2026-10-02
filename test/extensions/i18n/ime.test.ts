import { afterEach, describe, expect, it } from "vitest";
import { createBidiPlugin } from "../../../src/extensions/i18n";
import { mount, wait, type Mounted } from "../../plugins/helpers";
import { simulateComposition } from "./ime";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
});

/** Attribute writes anywhere in the editor, recorded while `fn` runs. */
async function attributeWrites(root: HTMLElement, fn: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const mo = new MutationObserver((rs) => rs.forEach((r) => r.type === "attributes" && seen.push(`${(r.target as Element).tagName}.${r.attributeName}`)));
  mo.observe(root, { attributes: true, subtree: true });
  await fn();
  await wait(5);
  mo.disconnect();
  return seen;
}

describe("the IME helper", () => {
  it("fires the CJK sequence in order", async () => {
    m = mount({ value: "x", plugins: [] });
    const log = await simulateComposition(m.surface, ["に", "にほ", "日本"]);
    expect(log).toEqual([
      "compositionstart",
      "beforeinput:insertCompositionText", "compositionupdate", "input:insertCompositionText",
      "beforeinput:insertCompositionText", "compositionupdate", "input:insertCompositionText",
      "beforeinput:insertCompositionText", "compositionupdate", "input:insertCompositionText",
      "compositionend", "input:insertText",
    ]);
    expect(m.surface.textContent).toContain("日本");
  });
  it("writes into a textarea's value", async () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.value = "ab";
    await simulateComposition(ta, ["か", "漢字"]);
    expect(ta.value).toBe("ab漢字");
    ta.remove();
  });
});

describe("the bidi plugin does nothing during a composition", () => {
  it("on the surface: blocks added mid-composition are painted only after compositionend", async () => {
    m = mount({ value: "مرحبا\n\nhello", plugins: [createBidiPlugin()] });
    const surface = m.surface;
    let added: HTMLElement | null = null;
    const writes = await attributeWrites(m.ed.element, () =>
      simulateComposition(surface, ["に", "にほ", "日本語"], {
        tickMs: 1,
        onStep: (i) => {
          if (i !== 1) return;
          added = document.createElement("ul");
          added.innerHTML = "<li>段落</li>";
          surface.appendChild(added);
        },
      }),
    );
    // the list that appeared during the composition got its dir only once the composition was over
    expect(added).not.toBeNull();
    expect(added!.getAttribute("dir")).toBe("auto");
    expect(writes.filter((w) => w === "UL.dir").length).toBeGreaterThan(0);
  });

  it("no attribute is written between compositionstart and compositionend", async () => {
    m = mount({ value: "مرحبا\n\nhello", plugins: [createBidiPlugin()] });
    const surface = m.surface;
    const seen: string[] = [];
    let open = false;
    const mo = new MutationObserver((rs) => {
      if (open) rs.forEach((r) => r.type === "attributes" && (r.attributeName === "dir" || r.attributeName === "data-atm-bidi") && seen.push(`${(r.target as Element).tagName}.${r.attributeName}`));
    });
    mo.observe(m.ed.element, { attributes: true, subtree: true });
    surface.addEventListener("compositionstart", () => (open = true));
    surface.addEventListener("compositionend", () => (open = false));
    await simulateComposition(surface, ["に", "日本"], {
      tickMs: 2,
      onStep: () => {
        const ul = document.createElement("ul");
        ul.innerHTML = "<li>x</li>";
        surface.appendChild(ul);
        m!.ed.exec("setDirection", "rtl"); // a command mid-composition is deferred too
      },
    });
    await wait(10);
    mo.disconnect();
    expect(seen).toEqual([]);
    expect(surface.getAttribute("dir")).toBe("rtl");
  });

  it("a deferred direction change is announced once, after the composition", async () => {
    m = mount({ value: "hi", plugins: [createBidiPlugin()] });
    const events: unknown[] = [];
    m.ed.on("plugin:i18n:direction", (p) => events.push(p));
    await simulateComposition(m.surface, ["に", "日本"], { onStep: (i) => i === 0 && m!.ed.exec("setDirection", "rtl") });
    await wait(5);
    expect(events).toEqual([{ dir: "rtl" }]);
  });

  it("on the Markdown textarea: the dir attribute is not rewritten while composing", async () => {
    m = mount({ value: "مرحبا", mode: "markdown", plugins: [createBidiPlugin()] });
    await wait(80);
    const ta = m.ed.element.querySelector<HTMLTextAreaElement>(".atm-markdown-host textarea")!;
    expect(ta.getAttribute("dir")).toBe("auto");
    const writes = await attributeWrites(ta, () => simulateComposition(ta, ["に", "日本語"], { tickMs: 1 }));
    expect(writes).toEqual([]);
    expect(ta.value.endsWith("日本語")).toBe(true);
  });
});
