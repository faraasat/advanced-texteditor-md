import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createChipCardsPlugin, enhanceChipCards } from "../../../src/extensions/chips/cards";
import { renderHtml } from "../../../src/render";
import { mount, wait } from "../../plugins/helpers";
import { cleanupBody, key, preload } from "./md-helpers";

beforeAll(preload);
const hosts: HTMLElement[] = [];
afterEach(() => {
  while (hosts.length) hosts.pop()!.remove();
  cleanupBody();
  vi.useRealTimers();
});
const card = () => document.querySelector<HTMLElement>(".atm-chip-card");
function html(md: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderHtml(md, { chipSchemes: ["tag"] });
  document.body.append(host);
  hosts.push(host);
  return host;
}
const pointer = (el: Element, type: string, pointerType = "touch") => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "pointerType", { value: pointerType });
  el.dispatchEvent(ev);
};

describe("enhanceChipCards", () => {
  it("makes renderHtml chips interactive and opens a card on focus", async () => {
    const getCard = vi.fn(() => ({ title: "Jane" }));
    const host = html("Hi [@Jane](mention:person/u1) and [#tag](tag:t)");
    const h = enhanceChipCards(host, { getCard, delayMs: 0 });
    const [a, b] = Array.from(host.querySelectorAll<HTMLElement>(".atm-chip"));
    for (const c of [a, b]) {
      expect(c.getAttribute("tabindex")).toBe("0");
      expect(c.getAttribute("role")).toBe("button");
      expect(c.hasAttribute("data-atm-interactive")).toBe(true);
    }
    await wait(20);
    a.focus();
    await wait(10);
    expect(card()?.getAttribute("role")).toBe("tooltip");
    key(a, "Escape");
    expect(card()).toBeNull();
    h.destroy();
  });

  it("is idempotent: refresh does not bind a chip twice", async () => {
    const getCard = vi.fn(() => ({ title: "Jane" }));
    const host = html("[@Jane](mention:u1)");
    const h = enhanceChipCards(host, { getCard, delayMs: 0 });
    h.refresh();
    h.refresh();
    await wait(20);
    host.querySelector<HTMLElement>(".atm-chip")!.focus();
    await wait(10);
    expect(getCard).toHaveBeenCalledTimes(1);
    h.destroy();
  });

  it("picks up chips added later on refresh", async () => {
    const host = html("[@A](mention:a)");
    const h = enhanceChipCards(host, { getCard: () => ({ title: "x" }), delayMs: 0 });
    host.insertAdjacentHTML("beforeend", renderHtml("[@B](mention:b)"));
    const b = host.querySelectorAll<HTMLElement>(".atm-chip")[1];
    expect(b.hasAttribute("tabindex")).toBe(false);
    h.refresh();
    expect(b.getAttribute("tabindex")).toBe("0");
    h.destroy();
  });

  it("destroy removes what it added, closes the card and unbinds", async () => {
    const getCard = vi.fn(() => ({ title: "Jane" }));
    const host = html("[@Jane](mention:u1)");
    const chip = host.querySelector<HTMLElement>(".atm-chip")!;
    const h = enhanceChipCards(host, { getCard, delayMs: 0 });
    await wait(20);
    chip.focus();
    await wait(10);
    expect(card()).not.toBeNull();
    h.destroy();
    expect(card()).toBeNull();
    for (const a of ["tabindex", "role", "data-atm-interactive", "aria-describedby"]) expect(chip.hasAttribute(a)).toBe(false);
    chip.blur();
    chip.focus();
    await wait(10);
    expect(card()).toBeNull();
    expect(getCard).toHaveBeenCalledTimes(1);
  });

  it("keeps a host's own tabindex and role, and respects schemes", () => {
    const host = html("[@A](mention:a) [#t](tag:t)");
    const [a, t] = Array.from(host.querySelectorAll<HTMLElement>(".atm-chip"));
    a.setAttribute("role", "link");
    const h = enhanceChipCards(host, { getCard: () => null, schemes: ["mention"] });
    expect(a.getAttribute("role")).toBe("link");
    expect(t.hasAttribute("data-atm-interactive")).toBe(false);
    h.destroy();
    expect(a.getAttribute("role")).toBe("link");
  });

  it("does nothing without a DOM element", () => {
    expect(() => enhanceChipCards(null, { getCard: () => null }).destroy()).not.toThrow();
  });

  it("a touch long-press opens the card; a short tap does not; an outside tap closes it", async () => {
    const host = html("[@Jane](mention:u1) [@Bob](mention:u2)");
    const [jane, bob] = Array.from(host.querySelectorAll<HTMLElement>(".atm-chip"));
    const h = enhanceChipCards(host, { getCard: () => ({ title: "Jane" }), delayMs: 0 });
    await wait(20);
    pointer(jane, "pointerdown");
    pointer(jane, "pointerup");
    await wait(600);
    expect(card()).toBeNull();
    pointer(jane, "pointerdown");
    await wait(600);
    expect(card()?.textContent).toContain("Jane");
    const ctx = new Event("contextmenu", { bubbles: true, cancelable: true });
    jane.dispatchEvent(ctx);
    expect(ctx.defaultPrevented).toBe(true);
    pointer(document.body, "pointerdown");
    expect(card()).toBeNull();
    pointer(bob, "pointerdown", "mouse");
    await wait(600);
    expect(card()).toBeNull(); // a mouse press is not a long-press
    h.destroy();
  });
});

describe("chip cards in the editor: interactive marker", () => {
  it("marks a chip on hover so CSS can show a pointer; a chip without a card is unmarked", async () => {
    const p = createChipCardsPlugin({ getCard: (c) => (c.id === "u1" ? { title: "Jane" } : null), delayMs: 0 });
    const m = mount({ value: "[@Jane](mention:u1) [@Bob](mention:u2)", plugins: [p] });
    await wait(30);
    const [jane, bob] = Array.from(m.surface.querySelectorAll<HTMLElement>(".atm-chip"));
    expect(jane.hasAttribute("data-atm-interactive")).toBe(true);
    bob.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(bob.hasAttribute("data-atm-interactive")).toBe(true);
    await wait(30);
    expect(bob.hasAttribute("data-atm-interactive")).toBe(false);
    bob.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(bob.hasAttribute("data-atm-interactive")).toBe(false);
    m.destroy();
  });
});
