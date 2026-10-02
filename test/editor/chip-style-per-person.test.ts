import { describe, it, expect, afterEach } from "vitest";
import { mount, tick } from "./fakes";
import { renderHtml } from "../../src/render/index";
import type { MentionItem, RenderOptions } from "../../src/types";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.querySelectorAll(".atm-mention-menu,.atm-mention-live").forEach((e) => e.remove());
});
const people: MentionItem[] = [
  { id: "a", label: "Ann", kind: "person", color: 3, badge: "Hub" },
  { id: "b", label: "Bob", kind: "person", color: "#aa00cc", badge: "CRM" },
];
const search = async () => people;
function typeAt(x: ReturnType<typeof mount>, text: string) {
  const ed = x.surface.editable;
  ed.textContent = "";
  const t = document.createTextNode(text);
  ed.appendChild(t);
  ed.focus();
  const r = document.createRange();
  r.setStart(t, text.length);
  r.collapse(true);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(r);
  ed.dispatchEvent(new Event("input", { bubbles: true }));
}
async function pick(persistStyle?: boolean, host = false) {
  const x = mount({ mentions: { search, persistStyle }, ...(host ? { chips: [{ scheme: "mention", kinds: { person: { color: 7, label: "Hub" } } }] } : {}) } as never);
  cleanups.push(x.cleanup);
  typeAt(x, "@A");
  await tick(30);
  x.surface.editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  return x;
}
const style = (x: Awaited<ReturnType<typeof pick>>, id: string) => (x.surface.options.render as RenderOptions).chipStyle?.({ type: "chip", scheme: "mention", kind: "person", id, label: id });

describe("chip colour and badge per person", () => {
  it("the renderer reads chipStyle and attrs._color/_badge", () => {
    const md = "[@Ann](mention:person/a)";
    expect(renderHtml(md, { chipStyle: () => ({ color: 3, badge: "Hub" }) })).toMatch(/chip-color:var\(--atm-chip-3\).*chip-badge">Hub/);
    expect(renderHtml("[@Ann](mention:person/a?_color=%23aa00cc&_badge=CRM)")).toMatch(/--atm-chip-color:#aa00cc.*chip-badge">CRM/);
  });
  it("a searched person is remembered per scheme:kind:id, even where the host styles the kind", async () => {
    const x = await pick(false, true);
    expect(style(x, "a")).toEqual({ color: 3, badge: "Hub" });
    expect(style(x, "b")).toEqual({ color: "#aa00cc", badge: "CRM" });
    expect(style(x, "zzz")).toBeUndefined();
  });
  it("wire format is untouched unless the host opts in", async () => {
    expect(((await pick()).surface.replaced[0].chip as { attrs?: unknown }).attrs).toBeUndefined();
    expect(((await pick(true)).surface.replaced[0].chip as { attrs?: unknown }).attrs).toEqual({ _color: "3", _badge: "Hub" });
  });
});
