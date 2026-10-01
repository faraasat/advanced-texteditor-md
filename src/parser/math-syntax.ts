/**
 * Inline math `$x$` / `$$x$$`. Currency-safe: the opener must be followed by a
 * non-space, the closer preceded by a non-space and not followed by a digit.
 * `dead[r]` remembers that no closer of run length r exists past a point, which
 * keeps a paragraph full of dollar signs linear.
 */
export function inlineMath(
  s: string,
  i: number,
  dead: Record<number, boolean>,
): { tex: string; end: number } | null {
  let r = 1;
  while (s[i + r] === "$") r++;
  if (r > 2 || dead[r]) return null;
  const a = i + r;
  if (a >= s.length || /\s/.test(s[a])) return null;
  for (let j = a; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") j++;
    else if (c === "$") {
      let rr = 1;
      while (s[j + rr] === "$") rr++;
      if (rr === r && j > a && !/\s/.test(s[j - 1]) && !/\d/.test(s[j + r] ?? "")) {
        return { tex: s.slice(a, j), end: j + r };
      }
      j += rr - 1;
    }
  }
  dead[r] = true;
  return null;
}

/** Block form: `$$` alone on a line opens, `$$` alone closes; `$$ x $$` is one line. */
export const MATH_OPEN = /^\$\$[ \t]*$/;
export const MATH_ONE = /^\$\$(.+?)\$\$[ \t]*$/;
