import { describe, it, expect, afterEach } from "vitest";
import { mount, tick } from "./fakes";
import { mirrorTheme } from "../../src/features/theme-mirror";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.documentElement.removeAttribute("data-atm-theme");
  document.querySelectorAll(".atm-mention-menu,.atm-mention-live").forEach((e) => e.remove());
});
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
const search = async () => [{ id: "a", label: "Ann" }];
async function menuFor(opts: Record<string, unknown>) {
  const x = mount({ mentions: { search }, ...opts } as never);
  cleanups.push(x.cleanup);
  typeAt(x, "@A");
  await tick(30);
  return { x, menu: document.querySelector<HTMLElement>(".atm-mention-menu")! };
}

describe("body-level menus carry the editor's theme", () => {
  it("dark editor on a light page", async () => {
    document.documentElement.setAttribute("data-atm-theme", "light");
    const { menu } = await menuFor({ theme: "dark", density: "compact" });
    expect(menu.getAttribute("data-atm-theme")).toBe("dark");
    expect(menu.getAttribute("data-atm-density")).toBe("compact");
  });
  it("light editor on a dark page", async () => {
    document.documentElement.setAttribute("data-atm-theme", "dark");
    const { menu } = await menuFor({ theme: "light" });
    expect(menu.getAttribute("data-atm-theme")).toBe("light");
  });
  it("setTheme updates an open menu", async () => {
    const { x, menu } = await menuFor({ theme: "light" });
    x.ed.setTheme("dark");
    await tick(5);
    expect(menu.getAttribute("data-atm-theme")).toBe("dark");
  });
  it("mirrorTheme copies dir and stops once the element leaves the document", async () => {
    const src = document.createElement("div");
    src.setAttribute("dir", "rtl");
    document.body.append(src);
    const el = document.createElement("div");
    document.body.append(el);
    mirrorTheme(src, el);
    expect(el.getAttribute("dir")).toBe("rtl");
    src.setAttribute("data-atm-theme", "sepia");
    await tick(5);
    expect(el.getAttribute("data-atm-theme")).toBe("sepia");
    el.remove();
    src.setAttribute("data-atm-theme", "dark");
    await tick(5);
    expect(el.getAttribute("data-atm-theme")).toBe("sepia");
    src.remove();
  });
});
