// Build-time facts about the library, read on the server while the static export is generated. Nothing here ships to the browser.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The repository root: the site always builds from site/, one level below it. */
export const ROOT = join(process.cwd(), "..");

export function readPackage(): { version: string; dependencies: number } {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string; dependencies?: Record<string, string> };
  return { version: pkg.version, dependencies: Object.keys(pkg.dependencies ?? {}).length };
}

/** The eager gzip size of the editor entry, from the same script CI runs. null when it cannot be read. */
export function editorGzipKb(): string | null {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/size.mjs")], { cwd: ROOT, encoding: "utf8" });
  const m = /index\.js\s+bundled\s+([\d.]+) kB/.exec(r.stdout ?? "");
  return m ? Number(m[1]).toFixed(1) : null;
}
