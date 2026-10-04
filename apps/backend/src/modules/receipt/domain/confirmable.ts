import { CONFIRMABLE_STATUSES } from '../receipt.constants';

/** How a store can confirm: normally, or early while the driver's record is still on the phone. */
export type ConfirmMode = 'NORMAL' | 'EARLY';

export interface ConfirmFacts {
  orderStatus: string;
  hasReceipt: boolean;
  stopStatus: string | null;
  /** The stop's ETA; the earliest an early confirmation can happen. */
  etaAt: Date | null;
}

/** A stop the driver has not finished: the only kind an early confirmation can be about. */
const OPEN_STOP = new Set(['PENDING', 'ARRIVED']);

/**
 * Whether, and how, the store can confirm now (specs/receipt/spec.md, Invariants):
 * once the driver's delivery has synced (the order is DELIVERED or PARTIAL), or after
 * the ETA has passed even though it has not (AC-RCP-03). Before both, never (AC-RCP-05),
 * and never twice (AC-RCP-08). There is no auto-confirm (AC-RCP-06), so the answer does
 * not change with the days that pass.
 */
export function confirmMode(
  facts: ConfirmFacts,
  now: Date,
): ConfirmMode | null {
  if (facts.hasReceipt) return null;
  if ((CONFIRMABLE_STATUSES as readonly string[]).includes(facts.orderStatus))
    return 'NORMAL';
  if (
    facts.orderStatus === 'IN_TRANSIT' &&
    facts.stopStatus !== null &&
    OPEN_STOP.has(facts.stopStatus) &&
    facts.etaAt !== null &&
    now.getTime() >= facts.etaAt.getTime()
  )
    return 'EARLY';
  return null;
}
