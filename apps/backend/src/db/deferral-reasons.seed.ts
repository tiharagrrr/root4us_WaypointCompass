import { DEFERRAL_REASONS } from '@waypoint/engine';
import type { deferralReasons } from './schema';

/**
 * The rows of `deferral_reasons`, taken from the engine's reason map so the
 * codes an engine run writes always exist (`deferrals.reasonCode` is a
 * foreign key). The description is what the store reads on M4; manual
 * reasons have none, because the store reads the dispatcher's note instead.
 */
export function deferralReasonRows(): (typeof deferralReasons.$inferInsert)[] {
  return DEFERRAL_REASONS.map((reason) => ({
    code: reason.code,
    label: reason.label,
    description: reason.storeText,
    fromEngine: reason.fromEngine,
    sortOrder: reason.sortOrder,
  }));
}
