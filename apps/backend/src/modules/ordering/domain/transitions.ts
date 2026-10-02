import {
  assertTransition,
  type OrderEvent,
  orderMachine,
  type OrderStatus,
  TransitionError,
} from '@waypoint/shared';
import { StateConflictError } from '../../../core/errors/domain-errors';

/**
 * The next status, or 409 CONFLICT_STATE.
 *
 * `assertTransition` throws the shared `TransitionError`, which the problem
 * filter already renders as 409. Ordering turns it into `StateConflictError`
 * first, so planning, loading, execution and receipt can catch the one error
 * class the module documents rather than reaching for a transport detail
 * (specs/ordering/spec.md, AC-ORD-36).
 */
export function nextOrderStatus(
  from: OrderStatus,
  event: OrderEvent,
): OrderStatus {
  try {
    return assertTransition(orderMachine, from, event);
  } catch (err) {
    if (err instanceof TransitionError)
      throw new StateConflictError(err.message);
    throw err;
  }
}
