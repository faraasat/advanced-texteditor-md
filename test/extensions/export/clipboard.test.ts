import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "../../../src/extensions/export/clipboard";

class FakeItem {
  constructor(public items: Record<string, Blob>) {}
}

function setClipboard(c: unknown) {
  Object.defineProperty(navigator, "clipboard", { value: c, configurable: true });
}

/** A document.execCommand that fires a copy event with a recording clipboardData, like a browser. */
function fakeExec(result = true) {
  const data: Record<string, string> = {};
  let called = 0;
  (document as unknown as { execCommand: unknown }).execCommand = (cmd: string) => {
    if (cmd !== "copy") return false;
    called++;
    const ev = new Event("copy", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    ev.clipboardData = { setData: (t: string, v: string) => (data[t] = v) };
    document.activeElement?.dispatchEvent(ev);
    return result;
  };
  return { data, calls: () => called };
}

beforeEach(() => {
  (window as unknown as { ClipboardItem?: unknown }).ClipboardItem = FakeItem;
});
afterEach(() => {
  setClipboard(undefined);
  delete (window as unknown as { ClipboardItem?: unknown }).ClipboardItem;
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

describe("copyToClipboard", () => {
  it("writes text/plain and text/html together through ClipboardItem", async () => {
    const write = vi.fn(async () => undefined);
    setClipboard({ write, writeText: vi.fn() });
    const r = await copyToClipboard({ text: "a", html: "<p>a</p>" });
    expect(r).toEqual({ ok: true, method: "clipboard-item" });
    const item = (write.mock.calls[0] as unknown as [FakeItem[]])[0][0];
    expect(Object.keys(item.items).sort()).toEqual(["text/html", "text/plain"]);
    expect(await item.items["text/html"].text()).toBe("<p>a</p>");
    expect(item.items["text/plain"].type).toBe("text/plain");
  });

  it("uses writeText for a text-only payload", async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText, write: vi.fn() });
    expect(await copyToClipboard({ text: "plain" })).toEqual({ ok: true, method: "write-text" });
    expect(writeText).toHaveBeenCalledWith("plain");
  });

  it("falls back to a copy event when the permission is refused", async () => {
    setClipboard({ write: vi.fn(async () => Promise.reject(new DOMException("no", "NotAllowedError"))) });
    const e = fakeExec();
    const r = await copyToClipboard({ text: "a", html: "<p>a</p>" });
    expect(r).toEqual({ ok: true, method: "copy-event" });
    expect(e.data).toEqual({ "text/plain": "a", "text/html": "<p>a</p>" });
  });

  it("falls back when there is no ClipboardItem or no clipboard at all", async () => {
    delete (window as unknown as { ClipboardItem?: unknown }).ClipboardItem;
    setClipboard({ write: vi.fn(), writeText: vi.fn() });
    const e = fakeExec();
    expect((await copyToClipboard({ text: "a", html: "<b>a</b>" })).method).toBe("copy-event");
    expect(e.data["text/html"]).toBe("<b>a</b>");
    setClipboard(undefined);
    expect((await copyToClipboard({ text: "z" })).method).toBe("copy-event");
    expect(e.data["text/plain"]).toBe("z");
  });

  it("reports failure when nothing works", async () => {
    setClipboard(undefined);
    expect(await copyToClipboard({ text: "a" })).toEqual({ ok: false, method: null });
    (document as unknown as { execCommand: unknown }).execCommand = () => false;
    expect(await copyToClipboard({ text: "a" })).toEqual({ ok: false, method: null });
  });

  it("leaves no textarea behind and restores the selection and focus", async () => {
    setClipboard(undefined);
    fakeExec();
    const input = document.createElement("div");
    input.tabIndex = 0;
    input.textContent = "hello";
    document.body.append(input);
    input.focus();
    const r = document.createRange();
    r.selectNodeContents(input);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r);
    await copyToClipboard({ text: "x" });
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(document.getSelection()!.toString()).toBe("hello");
    input.remove();
  });
});
