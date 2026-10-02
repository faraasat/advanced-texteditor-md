/** A small seeded PRNG (mulberry32) so a failing property test is reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
  };
}

const WORDS = ["alpha", "beta", "gamma", "delta", "River", "stone", "quick", "brown", "fox", "x", "42", "naïve", "日本語", "über"];
const SPANS = (p: ReturnType<typeof rng>) => {
  const w = p.pick(WORDS);
  const k = p.int(8);
  return k === 0 ? `**${w}**` : k === 1 ? `*${w}*` : k === 2 ? `\`${w}\`` : k === 3 ? `[${w}](https://example.com/${p.int(9)})` : w;
};

/** A random Markdown document: headings, paragraphs, lists, quotes, code, tables, rules. */
export function randomDoc(seed: number, blocks = 1 + (seed % 9)): string {
  const p = rng(seed);
  const para = () => Array.from({ length: 2 + p.int(8) }, () => SPANS(p)).join(" ");
  const out: string[] = [];
  for (let i = 0; i < blocks; i++) {
    const k = p.int(9);
    if (k === 0) out.push(`${"#".repeat(1 + p.int(3))} ${para()}`);
    else if (k === 1) out.push(Array.from({ length: 1 + p.int(4) }, () => `- ${para()}`).join("\n"));
    else if (k === 2) out.push(Array.from({ length: 1 + p.int(3) }, (_, j) => `${j + 1}. ${para()}`).join("\n"));
    else if (k === 3) out.push(`> ${para()}`);
    else if (k === 4) out.push("```js\nconst a = " + p.int(100) + ";\n```");
    else if (k === 5) out.push(`| a | b |\n| --- | --- |\n| ${p.pick(WORDS)} | ${p.int(100)} |`);
    else if (k === 6) out.push("---");
    else out.push(para());
  }
  return out.join("\n\n") + "\n";
}

/** A random edit of `md`: change, delete, insert and move blocks and words. */
export function mutate(md: string, seed: number): string {
  const p = rng(seed * 7919 + 13);
  const blocks = md.split(/\n{2,}/).filter((s) => s.trim());
  const edits = 1 + p.int(4);
  for (let e = 0; e < edits; e++) {
    const i = p.int(Math.max(1, blocks.length));
    const k = p.int(5);
    if (k === 0 && blocks.length) blocks.splice(i, 1);
    else if (k === 1) blocks.splice(i, 0, randomDoc(seed + e * 31, 1).trim());
    else if (k === 2 && blocks.length) blocks[i] = blocks[i].replace(/\b[a-zA-Z]{3,}\b/, p.pick(WORDS));
    else if (k === 3 && blocks.length) blocks[i] += " " + p.pick(WORDS);
    else if (blocks.length > 1) {
      const [b] = blocks.splice(i, 1);
      blocks.splice(p.int(blocks.length + 1), 0, b);
    }
  }
  return blocks.join("\n\n") + "\n";
}
