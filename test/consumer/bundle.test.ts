/**
 * A consumer's bundler, the way Vite pre-bundles a dependency: esbuild, `bundle` + `splitting`, ESM,
 * honouring the package's `"sideEffects"` field (the bundled file lives INSIDE the package, so its
 * package.json applies). Two things are checked against the BUILT `dist/`:
 *
 *   1. bundling prints no `ignored-bare-import` warning (scripts/strip-bare-imports.mjs removes the
 *      bare `import "./chunk-X.js"` lines esbuild's code splitting writes, after proving each chunk
 *      is side-effect free);
 *   2. the bundle still WORKS: the lazily imported rich-links chunk (link-preview cards) arrives
 *      through the consumer's own split chunks and draws a card.
 *
 * Skipped when `dist/` has not been built (run `npm run build` first).
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(__dirname, "../..");
const dist = join(root, "dist");
const built = existsSync(join(dist, "index.js"));

describe.skipIf(!built)("consumer bundle of dist/ (Vite-style esbuild pre-bundle)", () => {
  it("no dist file keeps a bare chunk import", () => {
    const offenders = readdirSync(dist)
      .filter((f) => f.endsWith(".js"))
      .filter((f) => /^import ["']\.\/[\w-]+-[A-Za-z0-9_-]{8}\.js["'];/m.test(readFileSync(join(dist, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("bundles without ignored-bare-import warnings, and the lazy rich-links chunk still loads", async () => {
    // Inside the package directory so its package.json "sideEffects" governs the dist files.
    const dir = mkdtempSync(join(root, "test-results", "consumer-"));
    try {
      const entry = join(dir, "app.js");
      writeFileSync(
        entry,
        `export { createEditor } from ${JSON.stringify(join(dist, "index.js"))};\n` +
          `export { BUILTIN_EMBEDS } from ${JSON.stringify(join(dist, "embeds.js"))};\n`,
      );
      // esbuild refuses to run inside jsdom (its Uint8Array invariant), so it runs in a child process.
      const script = `
        const { build } = require("esbuild");
        build({ entryPoints: [${JSON.stringify(entry)}], bundle: true, splitting: true, format: "esm",
          outdir: ${JSON.stringify(join(dir, "out"))}, write: true, logLevel: "silent", platform: "browser", target: "es2020" })
          .then((r) => console.log(JSON.stringify({ warnings: r.warnings.map((w) => (w.id || "") + " " + w.text), errors: r.errors.length })),
                (e) => { console.log(JSON.stringify({ warnings: [], errors: 1, message: String(e) })); });`;
      const run = spawnSync(process.execPath, ["-e", script], { cwd: root, encoding: "utf8" });
      const res = JSON.parse(run.stdout.trim().split("\n").pop() || "{}") as { warnings: string[]; errors: number };
      expect(res.warnings.filter((w) => /ignored-bare-import|no side effects/.test(w))).toEqual([]);
      expect(res.errors).toBe(0);

      const mod = (await import(/* @vite-ignore */ pathToFileURL(join(dir, "out", "app.js")).href)) as typeof import("../../src/index") & {
        BUILTIN_EMBEDS: unknown[];
      };
      const host = document.createElement("div");
      document.body.appendChild(host);
      const ed = mod.createEditor(host, {
        value: "https://example.com/page",
        linkPreview: { resolve: async (url) => ({ url, title: "Example page" }), modes: ["card"] },
      });
      // The rich-links chunk is a dynamic import inside the consumer's bundle: wait for its card.
      const card = await new Promise<Element | null>((done) => {
        const t0 = Date.now();
        const tick = () => {
          const c = host.querySelector("[data-atm-preview-card]");
          if (c || Date.now() - t0 > 5000) return done(c);
          setTimeout(tick, 20);
        };
        tick();
      });
      expect(card?.textContent).toContain("Example page");
      // ...and the card is not content.
      expect(ed.getValue()).toBe("https://example.com/page");
      ed.destroy();
      host.remove();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
