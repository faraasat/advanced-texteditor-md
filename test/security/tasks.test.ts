import { afterEach, describe, expect, it } from "vitest";
import { renderDom, renderHtml } from "../../src/render";
import { parse } from "../../src/parser/index";
import { hydrateAll } from "../../src/plugins/hydrate";
import { createTasks, filterTasks, progressBlocks, progressText, taskItems, tasksSummary, withDueDate, moveCompletedInMarkdown } from "../../src/extensions/tasks";
import { measureScaling, LINEAR_MAX_RATIO } from "../helpers/scaling";
import { mount, tick, type Mounted } from "../plugins/helpers";

const X = "window.__xss=1";
const tasks = createTasks({ today: "2026-10-02" });

const HOSTILE = [
  `- [ ] <img src=x onerror=${X}> [2026-10-02](date:2026-10-02)`,
  `- [ ] x [<img src=x onerror=${X}>](date:2026-10-02)`,
  `- [ ] x [2026-10-02](date:2026-10-02"><svg onload=${X}>)`,
  `- [ ] x [@<img src=x onerror=${X}>](mention:person/"><svg onload=${X}>)`,
  `- [ ] x [@__proto__](mention:person/__proto__) [@constructor](mention:person/constructor)`,
  `::: progress scope="section;background:url(javascript:${X})" onclick="${X}"\n<script>${X}</script>\n:::\n\n- [ ] a`,
  `::: progress\n[x](javascript:${X})\n:::`,
  `- [ ] ‮evil‬ [2026-10-02](date:2026-10-02) \u0000 ​`,
  `- [x] ${"a".repeat(20000)}`,
  `- [ ] x [2026-99-99](date:2026-99-99) [${"9".repeat(500)}](date:${"9".repeat(500)})`,
];

function unsafe(root: ParentNode): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((e) => {
    const tag = e.tagName;
    if (["SCRIPT", "IFRAME", "OBJECT", "EMBED", "STYLE"].includes(tag)) out.push(tag);
    for (const a of Array.from(e.attributes)) {
      if (a.name.startsWith("on")) out.push(`${tag}[${a.name}]`);
      if (a.name === "style" && /url\(|javascript|expression|@import/i.test(a.value)) out.push(`${tag}[style]`);
      if (["href", "src"].includes(a.name) && /^\s*javascript:/i.test(a.value)) out.push(`${tag}[${a.name}]`);
    }
  });
  return out;
}

describe("tasks: hostile input in views", () => {
  for (const md of HOSTILE) {
    it(JSON.stringify(md.slice(0, 50)), () => {
      (window as unknown as Record<string, unknown>).__xss = 0;
      const box = document.createElement("div");
      document.body.appendChild(box);
      box.appendChild(renderDom(md, { syntax: tasks.syntax, chips: tasks.chips, postRender: [tasks.postRender] }));
      expect(unsafe(box)).toEqual([]);
      box.querySelectorAll<HTMLButtonElement>(".atm-tasks-filter button").forEach((b) => b.click());
      const b2 = document.createElement("div");
      b2.innerHTML = renderHtml(md, { syntax: tasks.syntax, chips: tasks.chips });
      hydrateAll(b2, tasks.plugins, md);
      expect(unsafe(b2)).toEqual([]);
      expect((window as unknown as Record<string, unknown>).__xss).toBe(0);
      box.remove();
    });
  }
});

describe("tasks: hostile input in the editor", () => {
  let m: Mounted;
  afterEach(() => m?.destroy());
  for (const md of HOSTILE) {
    it(JSON.stringify(md.slice(0, 50)), async () => {
      m = mount({ value: md, plugins: tasks.plugins, chips: tasks.chips });
      await tick();
      expect(unsafe(m.ed.element)).toEqual([]);
      const v = m.ed.getValue();
      m.ed.setValue(v);
      await tick();
      expect(m.ed.getValue()).toBe(v); // decorations never change what is stored
    });
  }
});

describe("tasks: the model and the text helpers", () => {
  it("prototype keys as assignee ids do not pollute or collide", () => {
    const s = tasksSummary(parse(HOSTILE[4]), { today: "2026-10-02" });
    expect(s.byAssignee.map((a) => a.id)).toEqual(["__proto__", "constructor"]);
    expect(({} as Record<string, unknown>).total).toBeUndefined();
  });
  it("labels are data: the progress sentence is text, a hostile template is not markup", () => {
    const t = progressText(1, 2, { text: "<img src=x onerror=1>{done}" });
    const p = document.createElement("p");
    p.textContent = t;
    expect(p.querySelector("img")).toBeNull();
  });
  it("section scope in data cannot select anything but section", () => {
    const [b] = progressBlocks(parse(HOSTILE[5], { syntax: { block: tasks.syntax.block } }));
    expect(b.scope).toBe("document");
  });
  it("withDueDate refuses anything but a real date", () => {
    for (const bad of ["2026-10-02)](x", "2026-10-02\n- [ ] injected", "<script>", "", "9999-99-99"]) expect(withDueDate("- [ ] a", bad)).toBe("- [ ] a");
  });
  it("huge and odd inputs finish", () => {
    expect(taskItems(parse("- [ ] x\n".repeat(5000))).length).toBe(5000);
    expect(moveCompletedInMarkdown("- [x] a\n".repeat(3000) + "- [ ] b").changed).toBe(true);
  });
});

describe("tasks: linear time", () => {
  const md = (n: number) => Array.from({ length: n }, (_, i) => `- [${i % 2 ? "x" : " "}] task ${i} [2026-10-0${(i % 9) + 1}](date:2026-10-0${(i % 9) + 1})\n  - [ ] sub ${i}`).join("\n");
  it("the model is linear", () => {
    const r = measureScaling((n) => {
      const d = parse(md(n));
      return () => tasksSummary(d, { today: "2026-10-02" });
    }, 300);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("moving completed in text is linear", () => {
    const r = measureScaling((n) => {
      const src = md(n);
      return () => moveCompletedInMarkdown(src);
    }, 300);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("decorating and filtering a view is linear", () => {
    const r = measureScaling((n) => {
      const box = document.createElement("div");
      box.appendChild(renderDom(md(n), { chips: tasks.chips }));
      return () => {
        tasks.postRender(box, { doc: parse(""), mode: "view" });
        filterTasks(box, "open", { today: "2026-10-02" });
        filterTasks(box, "overdue", { today: "2026-10-02" });
      };
    }, 150);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});
