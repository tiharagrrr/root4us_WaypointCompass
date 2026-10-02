import { ALERT_TYPES, type AlertType } from '@waypoint/shared';

/**
 * What an alert is about. The catalog gives one subject kind per alert type,
 * so a dedupe key names the thing whose fix closes the alert: the stop whose
 * ETA slipped, the flag awaiting a decision, the trip nobody can drive.
 */
export const ALERT_SUBJECTS = [
  'stop',
  'trip',
  'load_flag',
  'issue',
  'deferral',
  'sync_conflict',
] as const;
export type AlertSubjectKind = (typeof ALERT_SUBJECTS)[number];

export interface AlertSubject {
  kind: AlertSubjectKind;
  id: string;
}

/**
 * The dedupe key for one alert: `LATE_RISK:stop:<id>`, the one form the doc
 * gives (specs/alerts/spec.md, Model). One OPEN or ACKNOWLEDGED alert exists
 * per key — the partial unique index `alerts_open_dedupe_uq` is what enforces
 * it — so raising the same alert twice updates the row it already has.
 *
 * The key is also the only place the subject's id is kept: `alerts` has
 * columns for the plan, trip, stop, order and outlet an alert is about, but
 * not for a flag, issue, deferral or conflict, and `subjectOf` reads it back
 * out for the fix link rather than adding four nullable columns.
 */
export function dedupeKeyFor(type: AlertType, subject: AlertSubject): string {
  return `${type}:${subject.kind}:${subject.id}`;
}

const SUBJECTS = new Set<string>(ALERT_SUBJECTS);
const TYPES = new Set<string>(ALERT_TYPES);

/**
 * The subject a dedupe key names, or null when the key is not one this build
 * wrote. A row older than a rename would read as null rather than throw: a
 * fix link is then left off, which is the safe way to be wrong.
 */
export function subjectOf(dedupeKey: string): AlertSubject | null {
  const [type, kind, ...rest] = dedupeKey.split(':');
  const id = rest.join(':');
  if (!TYPES.has(type) || !SUBJECTS.has(kind) || !id) return null;
  return { kind: kind as AlertSubjectKind, id };
}
