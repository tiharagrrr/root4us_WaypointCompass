import type { LoadFlagReason } from '@waypoint/shared';

/**
 * One loader action, however it reached the server: an online call from the
 * dock tablet, or the same tap replayed from its outbox through `POST /sync`
 * (specs/loading/spec.md, Services and helpers; specs/sync/spec.md).
 *
 * `LoaderEventService.apply()` takes this and nothing else, so the two paths
 * cannot drift, the way execution's `FieldEvent` does for the driver.
 *
 * The spec's sync table names four types. `LOAD_CHECK_UNDONE` is a fifth:
 * architecture rule 10 says every loader write goes through the outbox, and
 * undo is a loader write, so leaving it out would have made Undo the one
 * control on L2 that stops working when the dock's wifi does. The spec's
 * Open questions put the choice to Harini and Aniqa; this is the reading
 * that keeps the rule.
 *
 * Release is deliberately absent: it needs a connection, because it must
 * confirm the latest plan revision (AC-LOD-17).
 */
export const LOADER_EVENT_TYPES = [
  'LOAD_LINE_CHECKED',
  'LOAD_CHECK_UNDONE',
  'LOAD_FLAG_RAISED',
  'LOAD_FLAG_UNDONE',
  'LOAD_RECHECKED',
] as const;
export type LoaderEventType = (typeof LOADER_EVENT_TYPES)[number];

export interface LoaderEvent {
  /** Made on the tablet; the unique indexes make replays safe. */
  clientUuid: string;
  type: LoaderEventType;
  /** The line, for a check or an undo; the flag's line for a flag. */
  loadLineId?: string | null;
  /** The flag, for an undo or a re-check. */
  loadFlagId?: string | null;
  /** The device clock, already aligned to the server's. */
  occurredAt: Date;
  /** Creation order on the device, so a batch applies in the loader's order. */
  deviceSeq?: number | null;
  deviceId?: string | null;
  /**
   * The name typed on the shared tablet. Required on every check, flag and
   * re-check: on a dock where four loaders share one tablet, the account is
   * the tablet's and only this says who actually looked in the crate
   * (specs/loading/spec.md, "On a shared tablet every check, flag and
   * release carries a Checked by name").
   */
  checkedByName?: string | null;
  /** What was loaded, for a check or a re-check. */
  qtyLoaded?: number | null;
  /** LOAD_FLAG_RAISED. */
  reason?: LoadFlagReason | null;
  qtyAffected?: number | null;
  note?: string | null;
  /** A photo queued with the flag, by its own clientUuid rather than its id. */
  photoClientUuid?: string | null;
}

/**
 * What one item of a batch did. A batch never fails as a whole because of
 * one bad item (specs/api-conventions.md, section 3): every item comes back
 * with its own verdict, keyed by the clientUuid the tablet made.
 */
export type BatchStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface BatchResult {
  clientUuid: string;
  status: BatchStatus;
  /** Why, for `rejected` and `conflict`; one of LOAD_REJECTIONS. */
  code?: string;
  /** What the loader should do about it. */
  message?: string;
  /** The row the item touched, so the tablet can reconcile its cache. */
  id?: string;
}

/** Device order, then arrival order: a batch applies in the loader's order. */
export function inDeviceOrder<T extends { deviceSeq?: number | null }>(
  events: readonly T[],
): T[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        (a.event.deviceSeq ?? Number.MAX_SAFE_INTEGER) -
          (b.event.deviceSeq ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map((entry) => entry.event);
}
