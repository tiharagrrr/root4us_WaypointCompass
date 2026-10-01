export const EPSILON = 1e-6;

/** a <= b with a 1e-6 tolerance. Every limit check uses this, never <= on floats. */
export function lte(a: number, b: number): boolean {
  return a <= b + EPSILON;
}

/** Rounds half away from zero. Reported numbers go through round(x, 2). */
export function round(x: number, digits = 2): number {
  const factor = 10 ** digits;
  return (Math.sign(x) * Math.round(Math.abs(x) * factor)) / factor;
}
