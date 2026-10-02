import { expect } from "vitest";
import { BACKSTOP_MS, LINEAR_MAX_RATIO, measureScaling } from "../../helpers/scaling";

export function expectLinear(build: (size: number) => () => void, n: number): void {
  const r = measureScaling(build, n);
  expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  expect(r.large).toBeLessThan(BACKSTOP_MS);
}
