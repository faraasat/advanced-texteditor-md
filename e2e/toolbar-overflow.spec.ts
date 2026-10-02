import { test, expect, type Page } from "@playwright/test";

/**
 * The toolbar must fit its CONTAINER, not the window: in a narrow box (a drawer) the buttons that
 * do not fit go to More, never to a second row, and none is clipped or covered by the
 * Write/Markdown/Split switch.
 */
async function measure(page: Page, layout: string, width: number) {
  await page.goto("/example/index.html");
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return page.evaluate(
    async ({ layout, width }) => {
      const { createEditor } = await import("/dist/index.js");
      const box = document.createElement("div");
      box.id = "probe";
      box.style.cssText = `position:fixed;left:0;top:0;width:${width}px;z-index:99999;background:#fff`;
      document.body.append(box);
      createEditor(box, { layout, value: "x" });
      const raf = () => new Promise((r) => requestAnimationFrame(() => r(null)));
      await raf();
      await raf();
      await new Promise((r) => setTimeout(r, 100));
      const tb = box.querySelector(".atm-toolbar") as HTMLElement;
      const items = tb.querySelector(".atm-toolbar-items") as HTMLElement;
      const ir = items.getBoundingClientRect();
      const vis = Array.from(items.children).filter((e) => !(e as HTMLElement).hidden && (e as HTMLElement).offsetWidth > 0 && !e.classList.contains("atm-sep")) as HTMLElement[];
      const tops = new Set(vis.map((e) => Math.round(e.getBoundingClientRect().top)));
      const clipped = vis.filter((e) => e.getBoundingClientRect().right > ir.right + 0.5).map((e) => e.getAttribute("data-id"));
      const sw = tb.querySelector('.atm-mode-switch') as HTMLElement | null;
      const sr = sw?.getBoundingClientRect();
      const covered = sr ? vis.filter((e) => e.getBoundingClientRect().right > sr.left + 0.5 && e.getBoundingClientRect().left < sr.right).map((e) => e.getAttribute("data-id")) : [];
      if (!sw) throw new Error("mode switch not found");
      return { rows: tops.size, clipped, covered, more: !(tb.querySelector('[data-id="more"]') as HTMLElement | null)?.hidden, height: tb.getBoundingClientRect().height };
    },
    { layout, width },
  );
}

for (const layout of ["classic", "compact"]) {
  for (const width of [480, 730, 768]) {
    test(`${layout} toolbar in a ${width}px container: one row, nothing clipped or covered`, async ({ page }) => {
      const m = await measure(page, layout, width);
      expect(m.rows, JSON.stringify(m)).toBe(1);
      expect(m.clipped, JSON.stringify(m)).toEqual([]);
      expect(m.covered, JSON.stringify(m)).toEqual([]);
    });
  }
}
