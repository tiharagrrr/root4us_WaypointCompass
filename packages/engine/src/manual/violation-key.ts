import type { Violation } from '../types';

/**
 * Whether two violations are the same finding. Includes the numbers and the message, so a trip that
 * was over capacity and is now more over capacity counts as a new violation.
 */
export function violationKey(v: Violation): string {
  return [v.rule, v.severity, v.scope, v.tripKey, v.vehicleId, v.orderId, v.actual, v.limit, v.message].join('\u0000');
}
