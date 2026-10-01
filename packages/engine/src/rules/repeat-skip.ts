import { defineRule, violation } from './types';

export const REPEAT_SKIP = defineRule('REPEAT_SKIP', {
  check: ({ unplannedOrder, orderById, input, params }) => {
    if (!unplannedOrder) return [];
    const order = orderById.get(unplannedOrder.orderId);
    const history = order ? input.history[order.outletId] : undefined;
    if (!order || !history?.deferredOnLastRun || history.consecutiveDeferrals < params.repeatSkipLookbackRuns) return [];
    return [
      violation('REPEAT_SKIP', {
        orderId: order.id,
        message: `${order.outletId} was deferred on its last run; deferring it again needs a note`,
      }),
    ];
  },
});
