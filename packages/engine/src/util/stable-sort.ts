export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Returns a sorted copy; equal items keep their input order. */
export function stableSort<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...items].sort(compare);
}

/** Priority descending, then id ascending. */
export function compareByPriorityThenId(
  a: { priority: number; id: string },
  b: { priority: number; id: string },
): number {
  return b.priority - a.priority || compareText(a.id, b.id);
}
