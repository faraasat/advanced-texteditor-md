// Serves site/out/ under its GitHub Pages base path, the way Pages does: nothing is served outside /<repo>/, a directory
// answers with its index.html, and a miss answers with 404.html. No dependencies.
//
//   npm run site:serve                       http://127.0.0.1:4320/advanced-texteditor-md/
//   node scripts/serve-site.mjs --port 5000 --base /advanced-texteditor-md/
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "site", "out");
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const port = Number(opt("--port", process.env.PORT ?? 4320));
let base = opt("--base", process.env.SITE_BASE ?? "/advanced-texteditor-md/");
if (!base.startsWith("/")) base = "/" + base;
if (!base.endsWith("/")) base += "/";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon", ".map": "application/json", ".woff2": "font/woff2",
};

if (!existsSync(join(root, "index.html"))) {
  console.error("site/out/ is empty: run `npm run site:build` first.");
  process.exit(1);
}

const send = (res, code, file) => {
  res.writeHead(code, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = decodeURIComponent(url.pathname);
  if (path === base.slice(0, -1)) {
    res.writeHead(301, { location: base }).end();
    return;
  }
  if (!path.startsWith(base)) {
    res.writeHead(404, { "content-type": "text/plain" }).end(`not found (this site lives under ${base})`);
    return;
  }
  let rel = normalize(path.slice(base.length)).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, rel);
  if (file.startsWith(root) && existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith("/")) {
      res.writeHead(301, { location: path + "/" }).end();
      return;
    }
    file = join(file, "index.html");
  }
  if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) return send(res, 200, file);
  const nf = join(root, "404.html");
  if (existsSync(nf)) return send(res, 404, nf);
  res.writeHead(404).end("not found");
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}${base}`));
