import { dowOf } from '@waypoint/shared/business-time';
import { EngineInputError } from '../errors';

/**
 * Day of the week of the plan date, 0 = Monday.
 *
 * The engine does not parse dates itself: it relies on @waypoint/shared's dowOf refusing a date that
 * does not exist (2026-02-30) or is not YYYY-MM-DD. errors.spec.ts pins that contract from the engine
 * side, so a change in shared that weakens it fails an engine test too. The shared error is kept as
 * the cause.
 */
export function planDow(date: string): number {
  try {
    return dowOf(date);
  } catch (cause) {
    throw new EngineInputError({
      code: 'INVALID_DATE',
      field: 'input.date',
      value: date,
      reason: 'is not a calendar date: expected a day that exists, written YYYY-MM-DD',
      cause,
    });
  }
}
