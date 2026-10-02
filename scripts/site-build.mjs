// Builds the demo and docs site (site/, a Next.js App Router app) as a static export into site/out/.
//
//   npm run build && npm run site:install && npm run site:build
//   SITE_BASE=/advanced-texteditor-md/ npm run site:build     (the default: GitHub project pages)
//   SITE_BASE=/ npm run site:build                            (served from a domain root)
//
// The site depends on this package as "file:..", so it always reflects this commit: build the library first
// (the site imports dist/). Output is fully static; the only requests the page makes to other origins are the
// opt-in analytics ones (see docs/.research/site-analytics-2026-10-02.md).
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");

if (!existsSync(join(root, "dist", "index.js")) || !existsSync(join(root, "dist", "style.css"))) {
  console.error("dist/ is missing: run `npm run build` first.");
  process.exit(1);
}
if (!existsSync(join(site, "node_modules", "next"))) {
  console.error("site/node_modules is missing: run `npm run site:install` first.");
  process.exit(1);
}

let base = process.env.SITE_BASE ?? "/advanced-texteditor-md/";
if (!base.startsWith("/")) base = "/" + base;
const basePath = base === "/" ? "" : base.replace(/\/$/, "");

const r = spawnSync("npx", ["next", "build"], { cwd: site, stdio: "inherit", env: { ...process.env, NEXT_PUBLIC_BASE_PATH: basePath } });
if (r.status !== 0) process.exit(r.status ?? 1);

// GitHub Pages runs Jekyll unless told not to, and Jekyll drops directories that start with an underscore (_next).
writeFileSync(join(site, "out", ".nojekyll"), "");
console.log(`site built: ${join(site, "out")} (base ${base})`);
