import { describe, expect, it, afterEach } from "vitest";
import { parse, stringify } from "../../../src/parser";
import { renderHtml, renderDom } from "../../../src/render";
import { hydrateAll } from "../../../src/plugins/hydrate";
import {
  alertSyntax,
  alertKindOf,
  alertMarkdown,
  createAlertsPlugin,
  customKindCss,
  findAlerts,
  setAlertInSource,
  GFM_ALERT_KINDS,
} from "../../../src/extensions/alerts";
import { mount, tick, typeInto, pressKey, setSel, textareaReady, type Mounted } from "../../plugins/helpers";

const syntax = { inline: [alertSyntax()] };
const rt = (md: string) => stringify(parse(md, { syntax }), { syntax });

describe("alert syntax", () => {
  it("parses a marker at the start of a quote's first paragraph", () => {
    const doc = parse("> [!NOTE]\n> Useful.", { syntax });
    expect(alertKindOf(doc.children[0])).toBe("NOTE");
    expect(findAlerts(doc)).toHaveLength(1);
  });

  it("round-trips every GitHub kind without escaping the brackets", () => {
    for (const k of GFM_ALERT_KINDS) {
      const md = `> [!${k}]\n> Body **bold**.`;
      expect(rt(md)).toBe(md);
      expect(rt(rt(md))).toBe(md);
    }
  });

  it("writes the kind upper-case and drops trailing spaces on the marker line", () => {
    expect(rt("> [!note]  \n> x")).toBe("> [!NOTE]\n> x");
  });

  it("is GitHub's rule: alone on its line, at the start", () => {
    // Text after the marker on the same line: not an alert (GitHub shows it literally too).
    expect(alertKindOf(parse("> [!NOTE] title\n> x", { syntax }).children[0])).toBeNull();
    expect(alertKindOf(parse("> text [!NOTE]\n> x", { syntax }).children[0])).toBeNull();
    expect(alertKindOf(parse("> [!BOGUS]\n> x", { syntax }).children[0])).toBeNull();
    expect(rt("> [!BOGUS]\n> x")).toBe("> \\[!BOGUS\\]\n> x");
  });

  it("keeps a quote whose body is a separate paragraph", () => {
    const md = "> [!TIP]\n>\n> Para one.\n>\n> Para two.";
    expect(rt(md)).toBe(md);
    expect(alertKindOf(parse(md, { syntax }).children[0])).toBe("TIP");
  });

  it("finds nested alerts (in lists and quotes)", () => {
    const doc = parse("- item\n\n  > [!WARNING]\n  > careful\n\n> outer\n>\n> > [!CAUTION]\n> > inner", { syntax });
    expect(findAlerts(doc).map((a) => a.kind)).toEqual(["WARNING", "CAUTION"]);
  });

  it("alertMarkdown quotes every body line", () => {
    expect(alertMarkdown("tip", "a\n\nb")).toBe("> [!TIP]\n> a\n>\n> b");
    expect(alertMarkdown("NOTE")).toBe("> [!NOTE]");
  });

  it("renders a marker span with its kind; the quote is styled by CSS", () => {
    const html = renderHtml("> [!WARNING]\n> Careful.", { syntax });
    expect(html).toMatch(/<blockquote[^>]*><p[^>]*><span class="atm-custom atm-custom-alert atm-alert-marker" contenteditable="false" data-kind="WARNING">WARNING<\/span>/);
  });

  it("custom kinds", () => {
    const p = createAlertsPlugin({ kinds: [{ name: "bug", label: "Bug", color: "#d1242f" }] });
    const s = { inline: p.syntax!.inline! };
    expect(alertKindOf(parse("> [!BUG]\n> x", { syntax: s }).children[0])).toBe("BUG");
    expect(p.kinds).toEqual([...GFM_ALERT_KINDS, "BUG"]);
    expect(p.css).toContain("--atm-alert-c:#d1242f");
  });

  it("custom kind names and colours are validated", () => {
    const p = createAlertsPlugin({ gfm: false, kinds: [{ name: "x y" }, { name: "1A" }, { name: "__proto__" }, { name: "OK", color: "red;}body{x:1" }] });
    expect(p.kinds).toEqual(["OK"]);
    expect(p.css).toBeUndefined();
    expect(customKindCss([{ name: "OK", color: "url(javascript:alert(1))" }])).toBe("");
    expect(customKindCss([{ name: "OK", color: "rgb(1 2 3 / 50%)" }])).toContain("rgb(1 2 3 / 50%)");
  });
});

describe("setAlertInSource (Markdown pane)", () => {
  it("adds a marker to a quote", () => {
    const src = "a\n\n> quoted\n> more\n\nb";
    const r = setAlertInSource(src, src.indexOf("more"), "tip")!;
    const out = src.slice(0, r.from) + r.text + src.slice(r.to);
    expect(out).toBe("a\n\n> [!TIP]\n> quoted\n> more\n\nb");
    expect(out.slice(r.caret, r.caret + 4)).toBe("more");
  });
  it("changes and removes a marker", () => {
    const src = "> [!NOTE]\n> x";
    const c = setAlertInSource(src, src.length, "caution")!;
    expect(src.slice(0, c.from) + c.text + src.slice(c.to)).toBe("> [!CAUTION]\n> x");
    const r = setAlertInSource(src, src.length, null)!;
    const out = src.slice(0, r.from) + r.text + src.slice(r.to);
    expect(out).toBe("> x");
    expect(r.caret).toBe(out.length);
  });
  it("quotes a paragraph that is not in a quote", () => {
    const src = "one\ntwo\n\nthree";
    const r = setAlertInSource(src, 1, "NOTE")!;
    const out = src.slice(0, r.from) + r.text + src.slice(r.to);
    expect(out).toBe("> [!NOTE]\n> one\n> two\n\nthree");
    expect(out.slice(r.caret, r.caret + 2)).toBe("ne");
  });
  it("removing outside an alert does nothing", () => {
    expect(setAlertInSource("> x", 1, null)).toBeNull();
    expect(setAlertInSource("x", 1, null)).toBeNull();
  });
});

describe("views", () => {
  it("postRender (view) adds classes, role=note and the localised title", () => {
    const p = createAlertsPlugin({ labels: { NOTE: "Hinweis" } });
    const frag = renderDom("> [!NOTE]\n> x\n\n> plain", { syntax: p.syntax, postRender: [p.postRender!] });
    const div = document.createElement("div");
    div.append(frag);
    const [a, b] = Array.from(div.querySelectorAll("blockquote"));
    expect(a.className).toBe("atm-blockquote atm-alert atm-alert-note");
    expect(a.getAttribute("role")).toBe("note");
    expect(a.querySelector(".atm-alert-marker")!.textContent).toBe("Hinweis");
    expect(b.className).toBe("atm-blockquote");
  });
  it("hydrateAll works on renderHtml output", () => {
    const p = createAlertsPlugin();
    const div = document.createElement("div");
    div.innerHTML = renderHtml("> [!CAUTION]\n> x", { syntax: p.syntax });
    hydrateAll(div, [p], "> [!CAUTION]\n> x");
    expect(div.querySelector("blockquote")!.getAttribute("data-atm-alert")).toBe("CAUTION");
    expect(div.querySelector(".atm-alert-marker")!.textContent).toBe("Caution");
  });
});

describe("in the editor", () => {
  let m: Mounted | null = null;
  afterEach(() => {
    m?.destroy();
    m = null;
  });
  const open = (value: string, opts = {}) => {
    const plugin = createAlertsPlugin(opts);
    m = mount({ value, plugins: [plugin] });
    return m;
  };

  it("decorates without changing the Markdown", async () => {
    const md = "> [!IMPORTANT]\n> Read this.";
    const t = open(md, { labels: { IMPORTANT: "Wichtig" } });
    await tick();
    const q = t.surface.querySelector("blockquote")!;
    expect(q.classList.contains("atm-alert-important")).toBe(true);
    expect(q.querySelector(".atm-alert-marker")!.textContent).toBe("Wichtig");
    expect(t.ed.getValue()).toBe(md);
    // An edit elsewhere re-serialises: the marker is written back as [!IMPORTANT], the label never.
    const txt = q.querySelector("p")!.lastChild as Text;
    setSel(txt, txt.data.length);
    await typeInto(t.surface, "!");
    expect(t.ed.getValue()).toBe("> [!IMPORTANT]\n> Read this.!");
  });

  it("typing `[!TIP]` at the start of a quote makes a marker", async () => {
    const t = open("> x");
    const p = t.surface.querySelector("blockquote p")!;
    setSel(p.firstChild!, 0);
    await typeInto(t.surface, "[!TIP]");
    // The marker now sits before "x" on the same line: the plugin keeps it alone on its line.
    expect(t.ed.getValue()).toBe("> [!TIP]\n> x");
    expect(t.surface.querySelector("blockquote")!.classList.contains("atm-alert-tip")).toBe(true);
  });

  it("the `[!` menu completes a kind", async () => {
    const t = open("> a");
    const p = t.surface.querySelector("blockquote p")!;
    setSel(p.firstChild!, 0);
    await typeInto(t.surface, "[!wa");
    const opts = Array.from(document.querySelectorAll(".atm-mention-option"));
    expect(opts.map((o) => o.textContent)).toEqual(["Warning[!WARNING]"]);
    pressKey(t.surface, "Enter");
    await tick();
    expect(t.ed.getValue()).toBe("> [!WARNING]\n> a");
    expect(document.querySelector(".atm-mention-menu")).toBeNull();
  });

  it("the menu does not open outside a quote or mid-line", async () => {
    const t = open("para");
    const p = t.surface.querySelector("p")!;
    setSel(p.firstChild!, 4);
    await typeInto(t.surface, " [!n");
    expect(document.querySelector(".atm-mention-option")).toBeNull();
  });

  it("text typed right after the marker goes on the next line", async () => {
    const t = open("> [!NOTE]");
    const p = t.surface.querySelector("blockquote p")!;
    setSel(p, p.childNodes.length);
    await typeInto(t.surface, "Hi");
    expect(t.ed.getValue()).toBe("> [!NOTE]\n> Hi");
  });

  it("Enter right after the marker is a soft line break", async () => {
    const t = open("> [!NOTE]");
    const p = t.surface.querySelector("blockquote p")!;
    setSel(p, p.childNodes.length);
    const ev = pressKey(t.surface, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    await typeInto(t.surface, "Body");
    expect(t.ed.getValue()).toBe("> [!NOTE]\n> Body");
  });

  it("the alert command sets, changes and removes the kind (one undo step each)", async () => {
    const t = open("> quoted");
    const p = t.surface.querySelector("blockquote p")!;
    setSel(p.firstChild!, 3);
    expect(t.ed.exec("alert", "caution")).toBe(true);
    await tick();
    expect(t.ed.getValue()).toBe("> [!CAUTION]\n> quoted");
    const q = t.surface.querySelector("blockquote p")!;
    setSel(q.lastChild!, 2);
    t.ed.exec("alert", "TIP");
    await tick();
    expect(t.ed.getValue()).toBe("> [!TIP]\n> quoted");
    setSel(t.surface.querySelector("blockquote p")!.lastChild!, 2);
    t.ed.exec("alert", null);
    await tick();
    expect(t.ed.getValue()).toBe("> quoted");
    t.ed.undo();
    expect(t.ed.getValue()).toBe("> [!TIP]\n> quoted");
    t.ed.undo();
    expect(t.ed.getValue()).toBe("> [!CAUTION]\n> quoted");
    t.ed.undo();
    expect(t.ed.getValue()).toBe("> quoted");
  });

  it("the alert command quotes a paragraph first", async () => {
    const t = open("plain");
    setSel(t.surface.querySelector("p")!.firstChild!, 2);
    t.ed.exec("alert", "NOTE");
    await tick();
    expect(t.ed.getValue()).toBe("> [!NOTE]\n> plain");
  });

  it("insertAlert and the slash items", async () => {
    const plugin = createAlertsPlugin();
    expect(plugin.slash!.map((s) => s.id)).toEqual(["alert-note", "alert-tip", "alert-important", "alert-warning", "alert-caution"]);
    expect(plugin.slash![0].label).toBe("Note alert");
    m = mount({ value: "", plugins: [plugin] });
    m.ed.focus();
    m.ed.exec("insertAlert", "important");
    await tick();
    expect(m.ed.getValue()).toBe("> [!IMPORTANT]");
  });

  it("the toolbar switcher reflects the caret and switches", async () => {
    const t = open("> [!NOTE]\n> x\n\nafter");
    const sel = t.ed.element.querySelector<HTMLSelectElement>("select.atm-alert-switcher");
    expect(sel).not.toBeNull();
    expect(sel!.getAttribute("aria-label")).toBe("Alert type");
    const body = t.surface.querySelector("blockquote p")!.lastChild!;
    setSel(body, 1);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((r) => setTimeout(r, 60));
    expect(sel!.value).toBe("NOTE");
    sel!.value = "WARNING";
    sel!.dispatchEvent(new Event("change"));
    await tick();
    expect(t.ed.getValue()).toBe("> [!WARNING]\n> x\n\nafter");
  });

  it("works in the Markdown pane", async () => {
    const t = open("> body", {});
    t.ed.setMode("markdown");
    const ta = await textareaReady(t);
    ta.focus();
    ta.setSelectionRange(3, 3);
    expect(t.ed.exec("alert", "WARNING")).toBe(true);
    expect(t.ed.getValue()).toBe("> [!WARNING]\n> body");
    expect(ta.selectionStart).toBe("> [!WARNING]\n> b".length);
  });

  it("does nothing during an IME composition", async () => {
    const t = open("> a");
    const p = t.surface.querySelector("blockquote p")!;
    p.textContent = "[!TIP]";
    setSel(p.firstChild!, 6);
    t.surface.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", data: "]", bubbles: true }));
    await tick();
    expect(t.surface.querySelector(".atm-alert-marker")).toBeNull();
    const ev = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
    t.surface.dispatchEvent(ev);
    expect(document.querySelector(".atm-mention-menu")).toBeNull();
  });

  it("read-only: commands refuse", () => {
    const plugin = createAlertsPlugin();
    m = mount({ value: "> x", plugins: [plugin], readOnly: true });
    expect(m.ed.exec("alert", "NOTE")).toBe(false);
    expect(m.ed.exec("insertAlert", "NOTE")).toBe(false);
  });
});
