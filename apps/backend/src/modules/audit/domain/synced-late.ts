/** How far recordedAt may trail occurredAt before an entry counts as synced late. */
export const SYNCED_LATE_AFTER_MS = 5 * 60_000;

/**
 * Whether a row reached the server late: an offline event that was recorded more than
 * five minutes after it happened on the device. Exactly five minutes is not late.
 */
export function syncedLate(occurredAt: Date, recordedAt: Date): boolean {
  return recordedAt.getTime() - occurredAt.getTime() > SYNCED_LATE_AFTER_MS;
}
