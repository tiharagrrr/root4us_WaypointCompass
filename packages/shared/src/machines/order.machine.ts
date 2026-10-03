import type { OrderStatus } from '../domain';
import { defineMachine } from './machine';

export type OrderEvent =
  | 'SUBMIT'
  | 'EDIT'
  | 'CUTOFF'
  | 'PLAN'
  | 'DEFER'
  | 'REQUEUE'
  | 'LOAD'
  | 'DEPART'
  | 'DELIVER'
  | 'PARTIAL'
  | 'FAIL'
  | 'RECEIVE'
  | 'REPORT'
  | 'CANCEL';

/**
 * A deferred order stays DEFERRED until a run carries it: the plan for its new
 * date takes it straight to PLANNED, or defers it again (DEFERRED to DEFERRED,
 * one more on `deferredCount`). It never goes back to CONFIRMED in between, so
 * the store sees "Deferred to <date>" until it is on a trip.
 *
 * DEFERRED also accepts DELIVER and PARTIAL: when a device recorded a delivery
 * for a stop deferred while it was offline, KEEP_DEVICE on the sync conflict
 * (19c) reverses the deferral and stands the delivery.
 */
export const orderMachine = defineMachine<OrderStatus, OrderEvent>('order', {
  DRAFT: { SUBMIT: 'SUBMITTED', CANCEL: 'CANCELLED' },
  SUBMITTED: { EDIT: 'SUBMITTED', CUTOFF: 'CONFIRMED', CANCEL: 'CANCELLED' },
  CONFIRMED: { PLAN: 'PLANNED', DEFER: 'DEFERRED', CANCEL: 'CANCELLED' },
  DEFERRED: {
    PLAN: 'PLANNED',
    DEFER: 'DEFERRED',
    REQUEUE: 'CONFIRMED',
    DELIVER: 'DELIVERED',
    PARTIAL: 'PARTIAL',
    CANCEL: 'CANCELLED',
  },
  PLANNED: { LOAD: 'LOADED', DEFER: 'DEFERRED', REQUEUE: 'CONFIRMED' },
  LOADED: { DEPART: 'IN_TRANSIT', DEFER: 'DEFERRED' },
  IN_TRANSIT: {
    DELIVER: 'DELIVERED',
    PARTIAL: 'PARTIAL',
    FAIL: 'FAILED',
    DEFER: 'DEFERRED',
  },
  DELIVERED: { RECEIVE: 'RECEIVED', REPORT: 'ISSUE_REPORTED' },
  PARTIAL: { RECEIVE: 'RECEIVED', REPORT: 'ISSUE_REPORTED' },
  FAILED: { REQUEUE: 'CONFIRMED' },
  RECEIVED: { REPORT: 'ISSUE_REPORTED' },
  ISSUE_REPORTED: {},
  CANCELLED: {},
});
