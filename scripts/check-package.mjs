// Does the BUILT package behave like the package.json says? Run after `npm run build`, offline.
//
//   1. every tsup entry is exported, every export target exists (JS, d.ts, d.cts, css);
//   2. a tiny consumer imports every subpath by name and type-checks under moduleResolution
//      "bundler" (ESM) and "node16" (CJS);
//   3. every JS subpath loads in Node as ESM and as CJS, in a process with no DOM, and both
//      expose the same names;
//   4. tree-shaking works for a consumer's bundler: importing one small thing from the main entry
//      must not drag the editor in (esbuild, no splitting, the way most apps bundle);
//   5. `style.min.css` is smaller than `style.css` and parses to the same rule count;
//   6. `plugins.css` contains the five plugin stylesheets exactly as the plugins inject them.
//
// publint and @arethetypeswrong/cli are run only when they are already installed or in the npx
// cache (no network): `npx --no-install`. Otherwise they are skipped and the script says so.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const require = createRequire(join(root, "package.json"));
let failed = false;
const fail = (m) => {
  failed = true;
  console.log("FAIL " + m);
};
const ok = (m) => console.log("ok   " + m);

/* ── 1. exports vs entries vs files ── */
const tsup = readFileSync(join(root, "tsup.config.ts"), "utf8");
const entryBlock = /entry:\s*\{([\s\S]*?)\}/.exec(tsup)[1];
const entries = [...entryBlock.matchAll(/"?([\w/-]+)"?:\s*"([^"]+)"/g)].map((m) => m[1]);
const targets = [];
const walk = (v) => (typeof v === "string" ? targets.push(v) : v && Object.values(v).forEach(walk));
walk(pkg.exports);
for (const e of entries) {
  const base = e.startsWith("highlight/") ? "./highlight/*" : e === "index" ? "." : "./" + e;
  if (!pkg.exports[base]) fail(`tsup entry "${e}" has no "exports" key ${base}`);
}
for (const t of targets) {
  if (t.includes("*")) {
    const sample = t.replace("*", "javascript");
    if (!existsSync(join(root, sample))) fail(`export target ${t} (checked ${sample}) is missing`);
  } else if (!existsSync(join(root, t))) fail(`export target ${t} is missing`);
}
for (const f of ["main", "module", "types"]) if (!existsSync(join(root, pkg[f]))) fail(`package.json "${f}" -> ${pkg[f]} is missing`);
if (!failed) ok(`${entries.length} tsup entries, ${targets.length} export targets, all present`);

/* ── 2. type-check a consumer ── */
for (const cfg of ["tsconfig.bundler.json", "tsconfig.node16.json"]) {
  const r = spawnSync(join(root, "node_modules/.bin/tsc"), ["-p", join("test/consumer", cfg)], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) fail(`consumer type-check (${cfg}):\n${r.stdout}${r.stderr}`);
  else ok(`consumer type-check ${cfg}`);
}

/* ── 3. load every JS subpath, ESM and CJS, with no DOM ── */
const jsSubpaths = Object.keys(pkg.exports).filter((k) => !k.includes("*") && !/\.(css|json)$/.test(k));
jsSubpaths.push("./highlight/javascript", "./highlight/python");
for (const sub of jsSubpaths) {
  const spec = pkg.name + sub.slice(1);
  const code = `
    const cjs = require(${JSON.stringify(spec)});
    import(${JSON.stringify(spec)}).then((esm) => {
      const a = Object.keys(esm).filter((k) => k !== "default" && k !== "module.exports").sort();
      const b = Object.keys(cjs).filter((k) => k !== "default" && k !== "__esModule").sort();
      if (typeof document !== "undefined" || typeof window !== "undefined") throw new Error("a DOM exists in this process");
      console.log(JSON.stringify({ esm: a, cjs: b }));
    });`;
  const r = spawnSync(process.execPath, ["-e", code], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) {
    fail(`${spec}: ${r.stderr.trim().split("\n").slice(-3).join(" | ")}`);
    continue;
  }
  const { esm, cjs } = JSON.parse(r.stdout.trim().split("\n").pop());
  const missing = esm.filter((k) => !cjs.includes(k));
  const extra = cjs.filter((k) => !esm.includes(k));
  if (missing.length || extra.length) fail(`${spec}: ESM and CJS differ (only ESM: ${missing}; only CJS: ${extra})`);
  else if (!esm.length) fail(`${spec}: exports nothing`);
  else ok(`${spec.padEnd(40)} ESM + CJS, ${esm.length} names`);
}

/* ── 4. tree-shaking in a consumer's bundler ── */
const { buildSync } = await import("esbuild");
const dir = mkdtempSync(join(tmpdir(), "atm-consumer-"));
try {
  const probe = (name, source, maxKb, extra = {}) => {
    const entry = join(dir, name + ".js");
    writeFileSync(entry, source);
    const res = buildSync({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: "esm",
      write: false,
      logLevel: "silent",
      absWorkingDir: root,
      nodePaths: [join(dir, "node_modules")],
      alias: { [pkg.name]: join(root, "dist/index.js"), ...Object.fromEntries(jsSubpaths.filter((s) => s !== ".").map((s) => [pkg.name + s.slice(1), join(root, "dist", s.slice(2) + ".js")])) },
      ...extra,
    });
    const kb = gzipSync(res.outputFiles[0].contents, { level: 9 }).length / 1024;
    if (kb > maxKb) fail(`tree-shaking: ${name} bundles to ${kb.toFixed(2)} kB gzip (limit ${maxKb})`);
    else ok(`tree-shaking: ${name.padEnd(26)} ${kb.toFixed(2).padStart(6)} kB gzip (limit ${maxKb})`);
  };
  // The editor's own entry must not be pulled in by importing something small from it.
  probe("main-definePlugin", `import { definePlugin } from "${pkg.name}"; console.log(definePlugin);`, 0.5);
  probe("main-DEFAULT_LABELS", `import { DEFAULT_LABELS } from "${pkg.name}"; console.log(DEFAULT_LABELS);`, 1.5);
  probe("main-parse", `import { parse } from "${pkg.name}"; console.log(parse);`, 9);
  probe("main-renderHtml", `import { renderHtml } from "${pkg.name}"; console.log(renderHtml);`, 13);
  probe("math-texToMathML", `import { texToMathML } from "${pkg.name}/math"; console.log(texToMathML);`, 5.2);
  probe("embeds-matchEmbed", `import { matchEmbed } from "${pkg.name}/embeds"; console.log(matchEmbed);`, 1.2);
  probe("plugins-kbd", `import { kbd } from "${pkg.name}/plugins"; console.log(kbd);`, 0.7);
  probe("plugins-hydrateAll", `import { hydrateAll } from "${pkg.name}/plugins"; console.log(hydrateAll);`, 9);
  probe("plugins-typography", `import { simulateTyping } from "${pkg.name}/plugins"; console.log(simulateTyping);`, 3);
  // 4b. A split ESM bundle (Vite's dependency pre-bundling does this) prints no ignored-bare-import
  // warning: scripts/strip-bare-imports.mjs removed the bare chunk imports after proving them pure.
  {
    mkdirSync(join(root, "test-results"), { recursive: true });
    const entry = join(root, "test-results", "check-package-split.js");
    writeFileSync(entry, `export * from ${JSON.stringify(join(root, "dist/index.js"))};\nexport * from ${JSON.stringify(join(root, "dist/plugins.js"))};\n`);
    const res = buildSync({ entryPoints: [entry], bundle: true, splitting: true, format: "esm", outdir: join(dir, "split"), write: false, logLevel: "silent" });
    rmSync(entry, { force: true });
    const bare = res.warnings.filter((w) => w.id === "ignored-bare-import");
    if (bare.length) fail(`split bundle: ${bare.length} ignored-bare-import warning(s), e.g. ${bare[0].location?.file}`);
    else ok("split bundle: no ignored-bare-import warnings");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/* ── 5. the minified stylesheet ── */
{
  const a = readFileSync(join(root, "dist/style.css"), "utf8");
  const b = readFileSync(join(root, "dist/style.min.css"), "utf8");
  const count = (s) => (s.match(/\{/g) ?? []).length;
  if (b.length >= a.length) fail("style.min.css is not smaller than style.css");
  else if (count(a) !== count(b)) fail(`style.min.css has ${count(b)} blocks, style.css has ${count(a)}`);
  else ok(`style.min.css ${(b.length / 1024).toFixed(1)} kB (style.css ${(a.length / 1024).toFixed(1)} kB), same ${count(a)} blocks`);
}

/* ── 6. plugins.css is exactly what the plugins inject ── */
{
  const file = readFileSync(join(root, "dist/plugins.css"), "utf8");
  const mod = await import(pathToFileURL(join(root, "dist/plugins.js")).href);
  const strings = { FIND_REPLACE_CSS: mod.FIND_REPLACE_CSS, DRAFTS_CSS: mod.DRAFTS_CSS, TOC_CSS: mod.TOC_CSS, TEXT_STYLE_CSS: mod.TEXT_STYLE_CSS, SHORTCODES_CSS: mod.SHORTCODES_CSS };
  const missing = Object.entries(strings).filter(([, css]) => typeof css !== "string" || !file.includes(css)).map(([k]) => k);
  if (missing.length) fail(`dist/plugins.css does not contain ${missing.join(", ")} verbatim`);
  else ok(`plugins.css ${(file.length / 1024).toFixed(1)} kB, contains the five plugin stylesheets verbatim`);
  if (!pkg.exports["./plugins.css"]) fail('package.json has no "./plugins.css" export');
}

/* ── optional: publint, attw (only when they run offline) ── */
for (const [label, args] of [
  ["publint", ["--no-install", "publint"]],
  ["attw", ["--no-install", "@arethetypeswrong/cli", "--pack", ".", "--ignore-rules", "cjs-resolves-to-esm", "--format", "ascii"]],
]) {
  const r = spawnSync("npx", args, { cwd: root, encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (/npx canceled|missing packages|not found|ENOTFOUND|EAI_AGAIN/i.test(out) && r.status !== 0) {
    console.log(`skip ${label}: not installed and not in the npx cache (it would need the network)`);
    continue;
  }
  // The stylesheets are not JS or types: attw reports them as unresolvable, which is expected.
  const problems = out.split("\n").filter((l) => /💀|❌|✗|error/i.test(l) && !/style\.css|style\.min\.css|tailwind\.css|Resolution failed|NoResolution|Import failed to resolve/.test(l));
  if (problems.length) fail(`${label}:\n${problems.join("\n")}`);
  else ok(`${label}: no problems (stylesheet subpaths excluded, they are not JS)`);
}

process.exit(failed ? 1 : 0);
