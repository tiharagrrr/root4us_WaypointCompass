import {
  isLoaderEventType,
  syncDriverEventSchema,
  syncLoaderEventSchema,
  type SyncDriverEvent,
  type SyncLoaderEvent,
  type SyncResult,
} from '@waypoint/shared';
import type { FieldError } from '../../../core/errors/domain-errors';

/**
 * Pure helpers for a batch: the order it applies in, the parse of one event, and the shape the
 * two appliers take. No database here, so the tests use hand-made events.
 */

/** Device order first, then arrival order, so a batch applies in the order it was tapped. */
export function inDeviceOrder<T>(
  events: readonly T[],
  seqOf: (event: NoInfer<T>) => number | null | undefined,
): T[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        (seqOf(a.event) ?? Number.MAX_SAFE_INTEGER) -
          (seqOf(b.event) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map((entry) => entry.event);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The deviceSeq of an event not yet parsed, for ordering; absent ones go last. */
export const rawSeq = (raw: unknown): number | null =>
  isRecord(raw) && typeof raw.deviceSeq === 'number' ? raw.deviceSeq : null;

/** The clientUuid of an event not yet parsed, so even a malformed one gets a result. */
export const rawClientUuid = (raw: unknown): string =>
  isRecord(raw) && typeof raw.clientUuid === 'string' && raw.clientUuid
    ? raw.clientUuid
    : 'unknown';

export type ParsedEvent =
  | { kind: 'driver'; event: SyncDriverEvent }
  | { kind: 'loader'; event: SyncLoaderEvent }
  | { kind: 'invalid'; errors: FieldError[] };

/**
 * One event checked against the wire contract and sorted to its applier. The branch is picked by
 * `type` before parsing, so a bad field is reported by name rather than as a union mismatch.
 */
export function parseEvent(raw: unknown): ParsedEvent {
  const loader = isLoaderEventType(isRecord(raw) ? raw.type : undefined);
  const parsed = (
    loader ? syncLoaderEventSchema : syncDriverEventSchema
  ).safeParse(raw);
  if (!parsed.success) {
    return {
      kind: 'invalid',
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.') || 'event',
        code: issue.code,
        message: issue.message,
      })),
    };
  }
  return loader
    ? { kind: 'loader', event: parsed.data as SyncLoaderEvent }
    : { kind: 'driver', event: parsed.data as SyncDriverEvent };
}

/** The verdict for an event that failed the wire contract. */
export function rejected(
  clientUuid: string,
  code: string,
  message: string | undefined,
): SyncResult {
  return { clientUuid, status: 'rejected', code, message };
}

/** The counts a batch row and its event carry; received is their sum (specs/sync/spec.md, Model). */
export function tally(results: readonly SyncResult[]) {
  const count = (status: SyncResult['status']) =>
    results.filter((r) => r.status === status).length;
  return {
    received: results.length,
    applied: count('applied'),
    duplicates: count('duplicate'),
    conflicts: count('conflict'),
    rejected: count('rejected'),
  };
}
