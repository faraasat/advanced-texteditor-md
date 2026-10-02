// Builds the library (if needed) so example/index.html can import ../dist, then optionally serves the repo.
//
//   node scripts/build-example.mjs            build dist/ if it is missing or older than src/
//   node scripts/build-example.mjs --serve    ...and serve http://127.0.0.1:4319/example/index.html
//   node scripts/build-example.mjs --serve --port 5000 --force
//
// It adds nothing to package.json: it runs the tsup, strip-bare-imports and copy-css that `npm run build` already runs.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const port = Number(args[args.indexOf("--port") + 1]) || 4319;

function newest(dir) {
  let t = 0;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    t = Math.max(t, f.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

const out = join(root, "dist/index.js");
const stale = !existsSync(out) || !existsSync(join(root, "dist/style.css")) || statSync(out).mtimeMs < newest(join(root, "src"));
if (stale || flag("--force")) {
  console.log("building the library...");
  const tsup = join(root, "node_modules/.bin/tsup");
  for (const [cmd, a] of [
    [existsSync(tsup) ? tsup : "npx", existsSync(tsup) ? [] : ["tsup"]],
    ["node", [join(root, "scripts/strip-bare-imports.mjs")]],
    ["node", [join(root, "scripts/copy-css.mjs")]],
  ]) {
    const r = spawnSync(cmd, a, { cwd: root, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
} else console.log("dist/ is up to date");

for (const f of ["dist/index.js", "dist/style.css", "dist/highlight/javascript.js", "example/index.html", "example/main.js"]) {
  if (!existsSync(join(root, f))) {
    console.error(`missing ${f}`);
    process.exit(1);
  }
}

if (flag("--serve")) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".map": "application/json" };
  createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (p.endsWith("/")) p += "index.html";
    const file = join(root, p);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  }).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/example/index.html`));
} else console.log(`open it with: node scripts/build-example.mjs --serve   (or any static server rooted at the repo)`);
