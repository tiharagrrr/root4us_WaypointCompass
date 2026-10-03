import { isRepeatSkip } from '../plan/repeat-skip';
import { defineRule, violation } from './types';

/**
 * Whether deferring this outlet again is a repeat skip. The allocator sets `Unplanned.repeatSkip` from
 * the same function the rule uses, so the flag and the SOFT violation can never disagree.
 */
export function isRepeatSkip(
  history: FairnessHistory | undefined,
  params: Pick<EngineParams, 'repeatSkipLookbackRuns'>,
): boolean {
  if (!history?.deferredOnLastRun) return false;
  return history.consecutiveDeferrals >= params.repeatSkipLookbackRuns;
}

export const REPEAT_SKIP = defineRule('REPEAT_SKIP', {
  check: ({ unplannedOrder, orderById, input, params }) => {
    if (!unplannedOrder) return [];
    const order = orderById.get(unplannedOrder.orderId);
    const history = order ? input.history[order.outletId] : undefined;
    if (!order || !isRepeatSkip(history, params)) return [];
    return [
      violation('REPEAT_SKIP', {
        orderId: order.id,
        message: `${order.outletId} was deferred on its last run; deferring it again needs a note`,
      }),
    ];
  },
});
