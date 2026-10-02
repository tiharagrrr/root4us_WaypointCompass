import type { LoadFlagStatus, LoadLineStatus } from '@waypoint/shared';

/**
 * Last-stop-first order, and the grouping L2 draws (specs/loading/spec.md,
 * Services and helpers). Pure functions: the time and the rows come in as
 * parameters, so the same helpers serve the API, the builder and the tests.
 *
 * The invariant they exist for: *the first stop's goods go in last, nearest
 * the door.* A six-stop run is loaded 6, 5, 4, 3, 2, 1, so when the driver
 * opens the back at stop 1 the right pallets are in front of them.
 */

/** A stop as the order only needs to see it. */
export interface SequencedStop {
  /** Null once a stop is cancelled; such a stop is not loaded at all. */
  seq: number | null;
}

/**
 * The stops in loading order: highest seq first, a cancelled stop left out.
 * Equal seqs keep their incoming order, which `stops_trip_seq_uq` makes
 * impossible anyway; the fallback is there so a bad row cannot reorder a run
 * differently between two calls.
 */
export function loadOrder<T extends SequencedStop>(stops: readonly T[]): T[] {
  return stops
    .filter((stop) => stop.seq != null)
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => b.stop.seq! - a.stop.seq! || a.index - b.index)
    .map((entry) => entry.stop);
}

/** A line as the grouping needs it. */
export interface GroupableLine {
  stopSeq: number;
  status: LoadLineStatus;
}

/** One stop's lines, as L2 draws a stop card. */
export interface StopGroup<T> {
  stopSeq: number;
  lines: T[];
  /** How many of the group's lines still need a loader (PENDING or FLAGGED). */
  outstanding: number;
}

/**
 * The lines grouped by stop, groups last stop first and lines inside a group
 * in the order they came (the query sorts them, so that is the list's order).
 */
export function groupByStop<T extends GroupableLine>(
  lines: readonly T[],
): StopGroup<T>[] {
  const bySeq = new Map<number, T[]>();
  for (const line of lines) {
    const group = bySeq.get(line.stopSeq);
    if (group) group.push(line);
    else bySeq.set(line.stopSeq, [line]);
  }
  return [...bySeq.entries()]
    .sort(([a], [b]) => b - a)
    .map(([stopSeq, group]) => ({
      stopSeq,
      lines: group,
      outstanding: group.filter((line) => isOutstanding(line.status)).length,
    }));
}

/** A line nobody has settled yet; what L2's "3 of 18" counts against. */
export const isOutstanding = (status: LoadLineStatus): boolean =>
  status === 'PENDING' || status === 'FLAGGED';

/** A flag still waiting on somebody: the dispatcher, or the loader's re-check. */
export const isFlagOpen = (status: LoadFlagStatus): boolean =>
  status === 'OPEN' || status === 'AWAITING_RECHECK';

/**
 * The status a line returns to when its flag is undone (AC-LOD-09). The line
 * is no longer FLAGGED; where it goes depends on whether it had been checked
 * before the flag, which `qtyLoaded` records. No column keeps the status the
 * line held before, because this answers it without one.
 */
export const statusAfterUndo = (qtyLoaded: number | null): LoadLineStatus =>
  qtyLoaded == null ? 'PENDING' : 'OK';

/** Progress for the runs board and the trip list (AC-LOD-02). */
export interface LoadProgress {
  lines: number;
  checked: number;
  outstanding: number;
  openFlags: number;
}
