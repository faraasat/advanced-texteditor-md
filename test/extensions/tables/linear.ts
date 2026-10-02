import { expect } from "vitest";
import { BACKSTOP_MS, LINEAR_MAX_RATIO, measureScaling } from "../../helpers/scaling";

/** Assert that `build(n)` grows linearly (see test/helpers/scaling.ts). */
export function expectLinear(build: (n: number) => () => void, n: number): void {
  const r = measureScaling(build, n);
  expect(r.ratio, `${r.small.toFixed(1)} ms -> ${r.large.toFixed(1)} ms for 4x the input`).toBeLessThan(LINEAR_MAX_RATIO);
  expect(r.large).toBeLessThan(BACKSTOP_MS);
}
