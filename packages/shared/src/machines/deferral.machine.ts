import type { DeferralStatus, StoreResponse } from '../domain';
import { defineMachine } from './machine';

export type DeferralEvent = 'CONFIRM' | 'CANCEL' | 'REVERSE';

/**
 * The engine proposes; the dispatcher confirms with a reason (15). A proposal is
 * cancelled when the order is planned after all or swapped (16); a confirmed
 * deferral is reversed when a device's delivery is kept (19c).
 */
export const deferralMachine = defineMachine<DeferralStatus, DeferralEvent>(
  'deferral',
  {
    PROPOSED: { CONFIRM: 'CONFIRMED', CANCEL: 'CANCELLED' },
    CONFIRMED: { REVERSE: 'REVERSED' },
    REVERSED: {},
    CANCELLED: {},
  },
);

export type StoreResponseEvent = 'ACKNOWLEDGE' | 'REQUEST_PRIORITY';

/** M4: the store acknowledges a deferral or asks for priority with a note. */
export const storeResponseMachine = defineMachine<
  StoreResponse,
  StoreResponseEvent
>('deferral.storeResponse', {
  AWAITING: {
    ACKNOWLEDGE: 'ACKNOWLEDGED',
    REQUEST_PRIORITY: 'PRIORITY_REQUESTED',
  },
  ACKNOWLEDGED: {},
  PRIORITY_REQUESTED: {},
});
