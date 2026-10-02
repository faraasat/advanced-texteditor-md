import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createChipCardsPlugin, type ChipCardsOptions } from "../../../src/extensions/chips/cards";
import { createGroupMentions } from "../../../src/extensions/chips/groups";
import { renderDom } from "../../../src/render";
import { hydrateAll } from "../../../src/plugins/hydrate";
import { renderHtml } from "../../../src/render";
import { mount, setSel, wait, type Mounted } from "../../plugins/helpers";
import { cleanupBody, key, preload } from "./md-helpers";

const open: Mounted[] = [];
const hosts: HTMLElement[] = [];
beforeAll(preload);
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  while (hosts.length) hosts.pop()!.remove();
  cleanupBody();
});
const card = () => document.querySelector<HTMLElement>(".atm-chip-card");

function view(md: string, o: ChipCardsOptions) {
  const p = createChipCardsPlugin(o);
  const host = document.createElement("div");
  host.setAttribute("data-atm-theme", "dark");
  host.append(renderDom(md, { postRender: [p.postRender!] }));
  document.body.append(host);
  hosts.push(host);
  return { host, chip: host.querySelector<HTMLElement>(".atm-chip")!, p };
}

describe("chip cards: read-only views", () => {
  it("chips become focusable buttons; focus opens a tooltip the chip describes", async () => {
    const getCard = vi.fn(() => ({ title: "Jane Doe", subtitle: "Design", fields: [{ label: "Team", value: "A" }] }));
    const { chip } = view("Hi [@Jane](mention:person/u1)", { getCard, delayMs: 0 });
    expect(chip.getAttribute("tabindex")).toBe("0");
    expect(chip.getAttribute("role")).toBe("button");
    await wait(20); // the card UI is a lazy chunk
    chip.focus();
    await wait(10);
    const c = card()!;
    expect(c.getAttribute("role")).toBe("tooltip");
    expect(chip.getAttribute("aria-describedby")).toBe(c.id);
    expect(c.getAttribute("data-atm-theme")).toBe("dark");
    expect(c.textContent).toBe("Jane DoeDesignTeamA");
    expect(getCard).toHaveBeenCalledWith(
      { type: "chip", scheme: "mention", kind: "person", id: "u1", label: "Jane", trigger: "@" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    key(chip, "Escape");
    expect(card()).toBeNull();
    expect(chip.hasAttribute("aria-describedby")).toBe(false);
    expect(document.activeElement).toBe(chip);
  });

  it("a card with links is a non-modal dialog: Enter moves focus in, Escape returns it", async () => {
    const { chip } = view("[@Jane](mention:u1)", {
      delayMs: 0,
      getCard: async () => ({ title: "Jane", links: [{ label: "Profile", href: "https://example.com/jane" }, { label: "Mail", href: "https://example.com/m" }] }),
    });
    await wait(20);
    chip.focus();
    await wait(10);
    const c = card()!;
    expect(c.getAttribute("role")).toBe("dialog");
    expect(c.getAttribute("aria-modal")).toBe("false");
    expect(c.getAttribute("aria-label")).toBe("Jane");
    expect(chip.getAttribute("aria-haspopup")).toBe("dialog");
    expect(c.querySelector(".atm-chip-card-hint")!.textContent).toBe("Enter to reach the links");
    const a = c.querySelector("a")!;
    expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    const ev = key(chip, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    key(a, "Escape");
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("false");
  });

  it("hover opens after the delay, the grace period lets the pointer reach the card", async () => {
    const { chip } = view("[@Jane](mention:u1)", { delayMs: 30, graceMs: 30, getCard: () => ({ title: "Jane" }) });
    await wait(20);
    chip.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await wait(5);
    expect(card()).toBeNull();
    await wait(40);
    const c = card()!;
    expect(c).not.toBeNull();
    chip.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    c.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await wait(50);
    expect(card()).not.toBeNull(); // the pointer arrived in time
    c.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await wait(50);
    expect(card()).toBeNull();
  });

  it("caches per chip, aborts a load that is closed early (and does not cache it)", async () => {
    const signals: AbortSignal[] = [];
    let calls = 0;
    const { host } = view("[@A](mention:a) [@B](mention:b) [@A again](mention:a)", {
      delayMs: 0,
      getCard: (_c, { signal }) => {
        calls++;
        signals.push(signal);
        return new Promise((r) => setTimeout(() => r({ title: "x" }), 20));
      },
    });
    await wait(20);
    const [a, b, a2] = Array.from(host.querySelectorAll<HTMLElement>(".atm-chip"));
    a.focus();
    await wait(1);
    b.focus(); // closes A's pending load
    expect(signals[0].aborted).toBe(true);
    await wait(40);
    expect(card()).not.toBeNull();
    a2.focus();
    await wait(40);
    b.focus();
    await wait(5);
    expect(calls).toBe(3); // a (aborted), b, a again; b came from the cache the second time
  });

  it("schemes limits which chips get cards; null means no card", async () => {
    const getCard = vi.fn(() => null);
    const { host } = view("[@A](mention:a) [T](task:1)", { delayMs: 0, getCard, schemes: ["task"] });
    const chips = host.querySelectorAll<HTMLElement>(".atm-chip");
    expect(chips[0].hasAttribute("tabindex")).toBe(false);
    expect(chips.length).toBe(1); // task is not a known chip scheme without a definition
  });

  it("hydrateAll on renderHtml output works the same; an HTMLElement from getCard is used as is", async () => {
    const p = createChipCardsPlugin({
      delayMs: 0,
      getCard: () => {
        const e = document.createElement("div");
        e.className = "mine";
        e.textContent = "custom";
        return e;
      },
    });
    const host = document.createElement("div");
    host.innerHTML = renderHtml("[@A](mention:a)");
    document.body.append(host);
    hosts.push(host);
    hydrateAll(host, [p], "[@A](mention:a)");
    await wait(20);
    host.querySelector<HTMLElement>(".atm-chip")!.focus();
    await wait(10);
    expect(card()!.querySelector(".mine")!.textContent).toBe("custom");
  });

  it("group chips: the group helper's card lists the members", async () => {
    const g = createGroupMentions({ groups: [{ id: "team", label: "team", members: () => [{ id: "1", label: "Ann" }, { id: "2", label: "Bob" }] }] });
    const { chip } = view("[@team](mention:group/team)", { delayMs: 0, getCard: (c, ctx) => g.card(c, ctx) });
    await wait(20);
    chip.focus();
    await wait(10);
    expect(Array.from(card()!.querySelectorAll("li")).map((l) => l.textContent)).toEqual(["Ann", "Bob"]);
    expect(card()!.querySelector("ul")!.getAttribute("aria-labelledby")).toBe(card()!.querySelector(".atm-chip-card-list-label")!.id);
  });
});

describe("chip cards: in the editor", () => {
  it("the caret beside a chip opens its card; Alt+Down moves into links; Escape returns to the caret", async () => {
    const p = createChipCardsPlugin({ delayMs: 0, getCard: () => ({ title: "Jane", links: [{ label: "Open", href: "https://example.com" }] }) });
    const m = mount({ value: "Hi [@Jane](mention:u1) there", plugins: [p] });
    open.push(m);
    await wait(20);
    const chip = m.surface.querySelector<HTMLElement>(".atm-chip")!;
    expect(chip.hasAttribute("tabindex")).toBe(false); // never inside the surface
    m.surface.focus();
    const after = chip.nextSibling as Text;
    setSel(after, 0);
    document.dispatchEvent(new Event("selectionchange"));
    await wait(10);
    const c = card()!;
    expect(c.getAttribute("role")).toBe("dialog");
    expect(chip.getAttribute("aria-describedby")).toBe(c.id);
    expect(c.querySelector(".atm-chip-card-hint")!.textContent).toBe("Alt+Down to reach the links");
    const ev = key(m.surface, "ArrowDown", { altKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(c.querySelector("a"));
    key(document.activeElement as HTMLElement, "Escape");
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(m.surface);
    const sel = document.getSelection()!;
    expect(sel.anchorNode).toBe(after);
    // the Markdown never changed
    expect(m.ed.getValue().trim()).toBe("Hi [@Jane](mention:u1) there");
    expect(chip.hasAttribute("aria-describedby")).toBe(false);
  });

  it("Escape with the caret beside a chip closes the card (consumed), the same caret does not reopen it", async () => {
    const p = createChipCardsPlugin({ delayMs: 0, getCard: () => ({ title: "Jane" }) });
    const m = mount({ value: "[@Jane](mention:u1) x", plugins: [p] });
    open.push(m);
    await wait(20);
    const chip = m.surface.querySelector<HTMLElement>(".atm-chip")!;
    m.surface.focus();
    setSel(chip.nextSibling!, 0);
    document.dispatchEvent(new Event("selectionchange"));
    await wait(10);
    expect(card()!.getAttribute("role")).toBe("tooltip");
    const ev = key(m.surface, "Escape");
    expect(ev.defaultPrevented).toBe(true);
    expect(card()).toBeNull();
    document.dispatchEvent(new Event("selectionchange"));
    await wait(10);
    expect(card()).toBeNull();
    // moving the caret away and back opens it again
    setSel(chip.nextSibling!, 1);
    document.dispatchEvent(new Event("selectionchange"));
    setSel(chip.nextSibling!, 0);
    document.dispatchEvent(new Event("selectionchange"));
    await wait(10);
    expect(card()).not.toBeNull();
    // no card: Escape is not consumed
    setSel(chip.nextSibling!, 2);
    document.dispatchEvent(new Event("selectionchange"));
    expect(key(m.surface, "Escape").defaultPrevented).toBe(false);
  });

  it("destroy closes the card and aborts a pending load", async () => {
    let signal: AbortSignal | null = null;
    const p = createChipCardsPlugin({ delayMs: 0, getCard: (_c, ctx) => ((signal = ctx.signal), new Promise(() => {})) });
    const m = mount({ value: "[@Jane](mention:u1) x", plugins: [p] });
    await wait(20);
    m.surface.focus();
    setSel(m.surface.querySelector(".atm-chip")!.nextSibling!, 0);
    document.dispatchEvent(new Event("selectionchange"));
    await wait(5);
    m.destroy();
    expect(signal!.aborted).toBe(true);
  });

  it("IME: a composition keydown never opens or closes a card", async () => {
    const p = createChipCardsPlugin({ delayMs: 0, getCard: () => ({ title: "Jane" }) });
    const m = mount({ value: "[@Jane](mention:u1) x", plugins: [p] });
    open.push(m);
    await wait(20);
    m.surface.focus();
    setSel(m.surface.querySelector(".atm-chip")!.nextSibling!, 0);
    document.dispatchEvent(new Event("selectionchange"));
    await wait(10);
    expect(key(m.surface, "Escape", { isComposing: true }).defaultPrevented).toBe(false);
    expect(card()).not.toBeNull();
  });
});
