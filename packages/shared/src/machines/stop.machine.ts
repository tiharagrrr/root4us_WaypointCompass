import type { StopStatus } from '../domain';
import { defineMachine } from './machine';

export type StopEvent =
  'ARRIVE' | 'DELIVER' | 'PARTIAL' | 'FAIL' | 'CANCEL' | 'REINSTATE';

/**
 * Driver events move a stop; the dispatcher cancels one when it is deferred
 * mid-route or moved to another trip. REINSTATE brings a cancelled stop back
 * when KEEP_DEVICE resolves a sync conflict (19c).
 */
export const stopMachine = defineMachine<StopStatus, StopEvent>('stop', {
  PENDING: { ARRIVE: 'ARRIVED', CANCEL: 'CANCELLED' },
  ARRIVED: { DELIVER: 'DELIVERED', PARTIAL: 'PARTIAL', FAIL: 'FAILED' },
  DELIVERED: {},
  PARTIAL: {},
  FAILED: {},
  CANCELLED: { REINSTATE: 'PENDING' },
});
