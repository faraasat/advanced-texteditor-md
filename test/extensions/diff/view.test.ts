import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiffView, normalizeMarkdown, type DiffView } from "../../../src/extensions/diff";
import { renderDom } from "../../../src/render";
import { mutate, randomDoc } from "./rand";

const A = "# Title\n\nThe quick brown fox jumps over the lazy dog.\n\nMiddle stays the same.\n\nThis paragraph will be removed entirely now.\n\nEnd.\n";
const B = "# Title\n\nThe quick red fox jumps over the lazy dog.\n\nMiddle stays the same.\n\nA brand new paragraph appears here instead.\n\nEnd.\n";

let views: DiffView[] = [];
const make = (a = A, b = B, o: Parameters<typeof createDiffView>[2] = {}) => {
  const v = createDiffView(a, b, { container: document.body, ...o });
  views.push(v);
  return v;
};
afterEach(() => {
  views.forEach((v) => v.destroy());
  views = [];
});
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));

describe("createDiffView structure", () => {
  it("is a named region with a summary, and no changes for equal texts", () => {
    const v = make();
    expect(v.element.getAttribute("role")).toBe("region");
    expect(v.element.getAttribute("aria-label")).toBe("Document comparison");
    expect(v.element.querySelector(".atm-diff-summary")!.textContent).toMatch(/^\d+ changes?: \d+ insertions?, \d+ deletions?$/);
    const same = make("a\n", "a\n");
    expect(same.hunks).toHaveLength(0);
    expect(same.element.querySelector(".atm-diff-summary")!.textContent).toBe("No differences");
    expect((same.element.querySelector(".atm-diff-next") as HTMLButtonElement).disabled).toBe(true);
  });
  it("summary counts match the hunks", () => {
    const v = make();
    expect(v.summary.changes).toBe(v.hunks.length);
    expect(v.summary.insertions).toBeGreaterThan(0);
    expect(v.summary.deletions).toBeGreaterThan(0);
  });
  it("split mode: two aligned columns per row, word marks on the right sides", () => {
    const v = make(A, B, { mode: "split" });
    const row = v.element.querySelector(".atm-diff-hunk .atm-diff-row")!;
    expect(row.querySelector(".atm-diff-cell-a del.atm-diff-del")!.textContent).toContain("brown");
    expect(row.querySelector(".atm-diff-cell-b ins.atm-diff-ins")!.textContent).toContain("red");
    expect(row.querySelector(".atm-diff-cell-a ins")).toBeNull();
    expect(row.querySelector(".atm-diff-cell-b del")).toBeNull();
  });
  it("inline mode: one column with the deletion in place beside the insertion", () => {
    const v = make(A, B, { mode: "inline" });
    expect(v.element.getAttribute("data-mode")).toBe("inline");
    const p = v.element.querySelector(".atm-diff-hunk .atm-diff-block-mod p")!;
    expect(p.querySelector("del")!.textContent).toContain("brown");
    expect(p.querySelector("ins")!.textContent).toContain("red");
    expect(v.element.querySelector(".atm-diff-row")).toBeNull();
  });
  it("whole inserted and deleted blocks are classed blocks with text prefixes", () => {
    const v = make("one\n\ntwo\n", "one\n\nthree four five\n\nsix\n", { mode: "inline" });
    expect(v.element.querySelector(".atm-diff-block-del .atm-diff-sr")!.textContent).toBe("Deleted: ");
    expect(v.element.querySelector(".atm-diff-block-ins .atm-diff-sr")!.textContent).toBe("Inserted: ");
  });
  it("inserted and deleted runs carry hidden prefixes for screen readers", () => {
    const v = make();
    expect(v.element.querySelector("ins .atm-diff-sr")!.textContent).toBe("Inserted: ");
    expect(v.element.querySelector("del .atm-diff-sr")!.textContent).toBe("Deleted: ");
  });
  it("unchanged text in the right column is hidden from assistive technology (it repeats the left)", () => {
    const v = make();
    const ctx = v.element.querySelector(".atm-diff-context .atm-diff-cell-b")!;
    expect(ctx.getAttribute("aria-hidden")).toBe("true");
  });
  it("block granularity shows whole blocks only", () => {
    const v = make(A, B, { granularity: "block", mode: "inline" });
    expect(v.element.querySelector(".atm-diff-block-mod")).toBeNull();
    expect(v.element.querySelectorAll(".atm-diff-block-del").length).toBeGreaterThan(0);
  });
  it("a change in markup only (same words) still shows", () => {
    const v = make("some text here\n", "some **text** here\n", { mode: "inline" });
    expect(v.hunks).toHaveLength(1);
    expect(v.element.querySelector(".atm-diff-block-del")).not.toBeNull();
    expect(v.element.querySelector(".atm-diff-block-ins strong")).not.toBeNull();
  });
  it("renders with the library renderer options (custom syntax)", () => {
    const v = make("a\n", "a ==b==\n", { mode: "inline", render: { syntax: { inline: [{ name: "mark", open: "==", tag: "mark", className: "m" }] } } });
    expect(v.element.querySelector("mark.m")).not.toBeNull();
  });
  it("labels are overridable", () => {
    const v = make(A, B, { labels: { region: "Vergleich", acceptShort: "Übernehmen", accept: (i, n) => `Änderung ${i} von ${n} übernehmen`, inserted: "Eingefügt:" } });
    expect(v.element.getAttribute("aria-label")).toBe("Vergleich");
    expect(v.element.querySelector(".atm-diff-accept")!.getAttribute("aria-label")).toBe("Änderung 1 von 2 übernehmen");
    expect(v.element.querySelector("ins .atm-diff-sr")!.textContent).toBe("Eingefügt: ");
  });
  it("setMode switches the layout and keeps the decisions", () => {
    const v = make();
    v.accept(0);
    v.setMode("inline");
    expect(v.element.querySelector(".atm-diff-row")).toBeNull();
    expect(v.element.querySelector('.atm-diff-hunk[data-index="0"]')!.getAttribute("data-state")).toBe("accepted");
  });
});

describe("word marks keep the rendered text intact", () => {
  const textWithout = (el: Element, sel: string) => {
    const c = el.cloneNode(true) as Element;
    c.querySelectorAll(sel).forEach((n) => n.remove());
    return c.textContent;
  };
  const rendered = (md: string) => {
    const d = document.createElement("div");
    d.append(renderDom(md, {}, document));
    return d.textContent;
  };
  it("PROPERTY: removing the hidden prefixes (and deletions) leaves exactly the new text; removing prefixes and insertions leaves the old", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const a = randomDoc(seed + 700);
      const b = mutate(a, seed + 3);
      const split = createDiffView(a, b, { mode: "split" });
      const inline = createDiffView(a, b, { mode: "inline" });
      const mods = split.hunks.flatMap((h) => h.rows.flatMap((r) => (r.kind === "modify" ? [r] : [])));
      const olds = new Set(mods.map((r) => rendered(r.a)));
      const news = new Set(mods.map((r) => rendered(r.b)));
      const blocks = (v: DiffView) => Array.from(v.element.querySelectorAll(".atm-diff-block-mod"));
      const mk = blocks(split);
      expect(mk.length % 2).toBe(0);
      mk.forEach((el, i) => {
        if (i % 2 === 0) expect(olds.has(textWithout(el, ".atm-diff-sr, ins")!), `a seed ${seed}`).toBe(true);
        else expect(news.has(textWithout(el, ".atm-diff-sr")!), `b seed ${seed}`).toBe(true);
      });
      for (const el of blocks(inline)) expect(news.has(textWithout(el, ".atm-diff-sr, del")!), `inline seed ${seed}`).toBe(true);
      split.destroy();
      inline.destroy();
    }
  });
  it("marks inside nested inline elements split text nodes without losing markup", () => {
    const v = createDiffView("a **b c** d link [x y](https://e.com)\n", "a **b z** d link [x w](https://e.com)\n", { mode: "inline" });
    const p = v.element.querySelector(".atm-diff-block-mod p")!;
    expect(p.querySelector("strong ins")!.textContent).toContain("z");
    expect(p.querySelector("a ins")!.textContent).toContain("w");
    expect(p.querySelector("a")!.getAttribute("href")).toBe("https://e.com");
  });
});

describe("accept and reject", () => {
  it("buttons have accessible names and toggle aria-pressed", () => {
    const v = make();
    const n = v.hunks.length;
    const acc = v.element.querySelector('.atm-diff-hunk[data-index="1"] .atm-diff-accept') as HTMLButtonElement;
    expect(acc.getAttribute("aria-label")).toBe(`Accept change 2 of ${n}`);
    acc.click();
    expect(acc.getAttribute("aria-pressed")).toBe("true");
    acc.click();
    expect(acc.getAttribute("aria-pressed")).toBe("false");
    expect(v.getDecisions()[1]).toBeUndefined();
  });
  it("accepted hunks take B, rejected keep A, undecided follow `pending`", () => {
    const v = make();
    v.accept(0);
    v.reject(1);
    const m = v.getMerged();
    expect(m).toContain("quick red fox");
    expect(m).toContain("will be removed entirely");
    expect(m).not.toContain("brand new");
    const vb = make(A, B, { pending: "b" });
    vb.reject(0);
    expect(vb.getMerged()).toContain("brown fox");
    expect(vb.getMerged()).toContain("brand new");
  });
  it("acceptAll equals normalised B, rejectAll normalised A", () => {
    const v = make();
    v.acceptAll();
    expect(v.getMerged()).toBe(normalizeMarkdown(B));
    v.rejectAll();
    expect(v.getMerged()).toBe(normalizeMarkdown(A));
  });
  it("PROPERTY: acceptAll/rejectAll round trip on random edits, and the merged text is stable", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const a = randomDoc(seed + 300);
      const b = mutate(a, seed);
      for (const mode of ["split", "inline"] as const) {
        const v = createDiffView(a, b, { mode });
        v.acceptAll();
        expect(v.getMerged(), `accept ${seed}`).toBe(normalizeMarkdown(b));
        v.rejectAll();
        expect(v.getMerged(), `reject ${seed}`).toBe(normalizeMarkdown(a));
        if (v.hunks.length > 1) {
          v.accept(0);
          const m = v.getMerged();
          expect(normalizeMarkdown(m)).toBe(m);
        }
        v.destroy();
      }
    }
  });
  it("calls onAccept, onReject and onChange", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onChange = vi.fn();
    const v = make(A, B, { onAccept, onReject, onChange });
    v.accept(0);
    v.reject(1);
    expect(onAccept).toHaveBeenCalledWith(v.hunks[0], 0);
    expect(onReject).toHaveBeenCalledWith(v.hunks[1], 1);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0]).toBe(v.getMerged());
  });
  it("Accept all / Reject all buttons work and announce", () => {
    const v = make();
    (v.element.querySelector(".atm-diff-accept-all") as HTMLButtonElement).click();
    expect(v.getMerged()).toBe(normalizeMarkdown(B));
    expect(v.element.querySelector('[role="status"]')!.textContent).toBe("All changes accepted");
    (v.element.querySelector(".atm-diff-reject-all") as HTMLButtonElement).click();
    expect(v.getMerged()).toBe(normalizeMarkdown(A));
  });
  it("out of range indexes are ignored", () => {
    const v = make();
    v.accept(99);
    v.reject(-1);
    expect(v.getDecisions().every((d) => d === undefined)).toBe(true);
  });
});

describe("keyboard", () => {
  it("next and previous move focus to the change and wrap", () => {
    const v = make();
    const n = v.hunks.length;
    expect(v.next()).toBe(0);
    expect(document.activeElement).toBe(v.element.querySelector('.atm-diff-hunk[data-index="0"]'));
    expect(v.next()).toBe(1);
    expect(v.previous()).toBe(0);
    expect(v.previous()).toBe(n - 1);
    expect(v.element.querySelector('[role="status"]')!.textContent).toMatch(new RegExp(`^Change ${n} of ${n}`));
  });
  it("n / p and Alt+Arrow keys navigate; modified keys do not", () => {
    const v = make();
    const btn = v.element.querySelector(".atm-diff-accept-all") as HTMLElement;
    btn.focus();
    key(btn, "n");
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("0");
    key(document.activeElement!, "N");
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("1");
    key(document.activeElement!, "p");
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("0");
    key(document.activeElement!, "ArrowDown", { altKey: true });
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("1");
    key(document.activeElement!, "ArrowUp", { altKey: true });
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("0");
    const before = document.activeElement;
    key(before!, "n", { ctrlKey: true });
    key(before!, "n", { metaKey: true });
    expect(document.activeElement).toBe(before);
  });
  it("typing n in an input inside the view is left alone; composition does nothing", () => {
    const v = make();
    const input = document.createElement("input");
    v.element.append(input);
    input.focus();
    const ev = new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    const btn = v.element.querySelector(".atm-diff-next") as HTMLElement;
    btn.focus();
    const comp = new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true, isComposing: true });
    btn.dispatchEvent(comp);
    expect(comp.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(btn);
  });
  it("the Next and Previous buttons work, and a focus inside a change sets the position", () => {
    const v = make();
    (v.element.querySelector(".atm-diff-next") as HTMLButtonElement).click();
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("0");
    (v.element.querySelector('.atm-diff-hunk[data-index="0"] .atm-diff-accept') as HTMLElement).focus();
    (v.element.querySelector(".atm-diff-next") as HTMLButtonElement).click();
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("1");
  });
  it("focus stays on the button after accepting (nothing is rebuilt)", () => {
    const v = make();
    const btn = v.element.querySelector('.atm-diff-hunk[data-index="0"] .atm-diff-accept') as HTMLButtonElement;
    btn.focus();
    btn.click();
    expect(document.activeElement).toBe(btn);
  });
});

describe("lifecycle", () => {
  it("destroy removes the view", () => {
    const v = make();
    v.destroy();
    expect(v.element.isConnected).toBe(false);
  });
  it("works detached, without a container", () => {
    const v = createDiffView(A, B);
    expect(v.element.isConnected).toBe(false);
    expect(v.getMerged()).toBe(normalizeMarkdown(A));
  });
});
