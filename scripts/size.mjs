// Gzip size of every built JS entry against the budgets in docs/ARCHITECTURE.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const BUDGET_KB = { "index.js": 55, "parser.js": 14, "render.js": 14, "math.js": 5 };
const LANG_KB = 2;
let failed = false;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

for (const file of walk("dist").filter((f) => f.endsWith(".js"))) {
  const kb = gzipSync(readFileSync(file)).length / 1024;
  const rel = file.replace(/^dist\//, "");
  const budget = rel.startsWith("highlight/") ? LANG_KB : BUDGET_KB[rel];
  const over = budget !== undefined && kb > budget;
  if (over) failed = true;
  console.log(`${over ? "OVER" : "ok  "} ${rel.padEnd(28)} ${kb.toFixed(2)} kB${budget ? ` / ${budget}` : ""}`);
}
process.exit(failed ? 1 : 0);
