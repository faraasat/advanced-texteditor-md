/**
 * Performance assertions that do not depend on how busy the machine is.
 *
 * An absolute "under 400 ms" check measures the CPU the test happened to get; a quadratic bug and
 * a loaded laptop look the same. What a regression changes is how the work GROWS with the input,
 * so these helpers time the same function at size n and at 4n, take the best of a few runs at each
 * (load only ever makes a run slower, so the minimum is the least disturbed one), and compare:
 * linear work gives a ratio near 4, quadratic work gives 16. The default limit of 10 sits between
 * them. A very generous absolute backstop catches a hang without ever catching a slow machine.
 */
export const best = (fn: () => void, runs = 3): number => {
  let m = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    m = Math.min(m, performance.now() - t);
  }
  return m;
};

export type Scaling = { small: number; large: number; ratio: number };

/**
 * `build(size)` returns the function to time at that size. Throws (via the returned object being
 * checked by the caller's `expect`) nothing itself: use `expectLinear`.
 */
export function measureScaling(build: (size: number) => () => void, n: number, factor = 4, runs = 3): Scaling {
  let result: Scaling | null = null;
  // A pause (GC, another process) can inflate one measurement; quadratic work inflates EVERY one.
  // So a result over the limit is measured again, and only a limit exceeded three times in a row counts.
  for (let attempt = 0; attempt < 3; attempt++) {
    const small = best(build(n), runs);
    const large = best(build(n * factor), runs);
    // Below ~2 ms a timer reading is mostly noise: compare against a floor instead of dividing by it.
    const r = { small, large, ratio: large / Math.max(small, 2) };
    if (!result || r.ratio < result.ratio) result = r;
    if (result.ratio < LINEAR_MAX_RATIO) break;
  }
  return result!;
}

export const LINEAR_MAX_RATIO = 10;
export const BACKSTOP_MS = 30_000;
