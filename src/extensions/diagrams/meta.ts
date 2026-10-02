/**
 * The info string of a fenced block, after the language: ```` ```mermaid title="Login flow" wide ````.
 * `key="value"`, `key='value'` and `key=value` pairs, `\"` and `\\` escapes inside quotes, and a bare
 * word is a flag (`"true"`). One pass, linear. The result has no prototype, so `__proto__` is an
 * ordinary key and nothing is inherited.
 */
export function parseDiagramMeta(meta: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  const s = typeof meta === "string" ? meta : "";
  const n = s.length;
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) break;
    const k0 = i;
    while (i < n && s[i] !== "=" && !/\s/.test(s[i])) i++;
    const key = s.slice(k0, i);
    if (i < n && s[i] === "=") {
      i++;
      let val = "";
      const q = s[i];
      if (q === '"' || q === "'") {
        i++;
        while (i < n && s[i] !== q) {
          if (s[i] === "\\" && i + 1 < n && (s[i + 1] === q || s[i + 1] === "\\")) i++;
          val += s[i++];
        }
        i++; // the closing quote (or the end)
      } else {
        const v0 = i;
        while (i < n && !/\s/.test(s[i])) i++;
        val = s.slice(v0, i);
      }
      if (key) out[key] = val;
    } else if (key) {
      out[key] = "true";
    }
  }
  return out;
}
