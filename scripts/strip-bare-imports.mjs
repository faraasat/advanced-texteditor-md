// Removes the bare `import './chunk-XXXXXXXX.js';` lines esbuild's code splitting writes into dist/.
//
// esbuild emits a bare import of a shared chunk to keep module EVALUATION ORDER when a module of one
// chunk imports a module of another without using any of its bindings. package.json says the package
// has no side effects outside its CSS (`"sideEffects": ["**/*.css"]`), so a consumer's bundler drops
// those imports anyway, and esbuild (also inside Vite's dependency pre-bundling) prints an
// `ignored-bare-import` warning for each one. They are dead weight that only produces warnings.
//
// A bare import is removed ONLY after esbuild itself proves the chunk is side-effect free: the chunk is
// copied (with every other dist file) to a directory OUTSIDE the package, so no `sideEffects` field
// applies, and `import "./chunk.js"` is bundled with tree-shaking. An empty bundle means evaluating the
// chunk does nothing observable, so skipping its evaluation cannot change behaviour. A chunk that is
// not provably pure keeps its import and the script exits 1 (a module-level side effect is a bug in
// this package: see docs/ARCHITECTURE.md, rule 2). docs/DECISIONS.md, "Bare chunk imports".
import { build } from "esbuild";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const DIST = "dist";
const BARE = /^import ["'](\.\/(?:[\w-]+\/)*[\w-]+-[A-Za-z0-9_-]{8}\.js)["'];\r?\n/gm;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(DIST).filter((f) => f.endsWith(".js"));
const wanted = new Map(); // file -> [spec]
for (const f of files) {
  const specs = [...readFileSync(f, "utf8").matchAll(BARE)].map((m) => m[1]);
  if (specs.length) wanted.set(f, specs);
}

const tmp = mkdtempSync(join(tmpdir(), "atm-pure-"));
let failed = false;
try {
  cpSync(DIST, join(tmp, "d"), { recursive: true, filter: (s) => statSync(s).isDirectory() || s.endsWith(".js") });
  const pure = new Map();
  const isPure = async (abs) => {
    if (pure.has(abs)) return pure.get(abs);
    const rel = relative(DIST, abs).split("\\").join("/");
    const r = await build({
      stdin: { contents: `import "./${rel}";`, resolveDir: join(tmp, "d"), loader: "js" },
      bundle: true,
      write: false,
      format: "esm",
      treeShaking: true,
      minify: true,
      logLevel: "silent",
      platform: "neutral",
    });
    const ok = r.outputFiles[0].text.trim() === "";
    pure.set(abs, ok);
    return ok;
  };
  let removed = 0;
  for (const [f, specs] of wanted) {
    let src = readFileSync(f, "utf8");
    for (const spec of specs) {
      const target = join(f, "..", spec);
      if (await isPure(target)) {
        src = src.replace(new RegExp(`^import ["']${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'];\\r?\\n`, "m"), "");
        removed++;
      } else {
        failed = true;
        console.error(`strip-bare-imports: ${relative(DIST, target)} has a module-level side effect; kept its bare import in ${relative(DIST, f)}`);
      }
    }
    writeFileSync(f, src);
  }
  console.log(`strip-bare-imports: removed ${removed} bare chunk import(s) from ${wanted.size} file(s)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
