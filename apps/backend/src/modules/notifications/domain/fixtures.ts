import type { Facts, Payload } from './catalog';

/**
 * Example data for every catalog event: the preview endpoint renders it and
 * the template test checks each channel's limits against it (AC-NTF-14).
 * Names follow the demo day; the longest real names are used on purpose.
 */
export const FIXTURES: Record<
  string,
  { payload: Payload; facts: Facts; entityId: string }
> = {
  'order.submitted': {
    payload: { orderId: 'o1', outletId: 'OUT01', deliveryDate: '2026-10-02' },
    facts: { orderNo: 'WF-0171', outletName: 'Fresh Kadawatha' },
    entityId: 'o1',
  },
  'order.rolled_to_next_run': {
    payload: {
      orderId: 'o1',
      deliveryDate: '2026-10-03',
      reason: 'AFTER_CUTOFF',
    },
    facts: { orderNo: 'WF-0171' },
    entityId: 'o1',
  },
  'plan.published': {
    payload: {
      planId: 'p1',
      date: '2026-10-02',
      tripIds: Array.from({ length: 24 }, (_, i) => `t${i}`),
    },
    facts: { vehicleCode: 'REF-07', tripNo: 1, stops: 6 },
    entityId: 'p1',
  },
  'plan.revised': {
    payload: { planId: 'p1', date: '2026-10-02', tripIds: ['t1'] },
    facts: { vehicleCode: 'REF-07', tripNo: 1, stops: 6 },
    entityId: 'p1',
  },
  'deferral.confirmed': {
    payload: {
      deferralId: 'd1',
      orderId: 'o1',
      toDate: '2026-10-03',
      reasonCode: 'NO_REEFER_CAPACITY',
    },
    facts: { orderNo: 'WF-0171' },
    entityId: 'd1',
  },
  'deferral.store_responded': {
    payload: {
      deferralId: 'd1',
      orderId: 'o1',
      priorityRequested: true,
      note: 'Dairy for the weekend',
    },
    facts: { orderNo: 'WF-0171', outletName: 'Fresh Divulapitiya' },
    entityId: 'd1',
  },
  'load.flag_raised': {
    payload: { flagId: 'f1', tripId: 't1', qtyAffected: 2, reason: 'MISSING' },
    facts: {
      vehicleCode: 'REF-07',
      outletName: 'Fresh Kadawatha',
      orderNo: 'WF-0171',
    },
    entityId: 'f1',
  },
  'load.flag_decided': {
    payload: { flagId: 'f1', tripId: 't1', decision: 'REPLACE_FROM_STOCK' },
    facts: { orderNo: 'WF-0171' },
    entityId: 'f1',
  },
  'trip.released': {
    payload: { tripId: 't1' },
    facts: {
      vehicleCode: 'REF-07',
      tripNo: 1,
      stops: 6,
      firstOutletName: 'Fresh Kadawatha',
      firstArrivalAt: '2026-10-01T22:40:00.000Z',
    },
    entityId: 't1',
  },
  'stop.completed': {
    payload: {
      stopId: 's1',
      orderId: 'o1',
      completedAt: '2026-10-01T22:52:00.000Z',
    },
    facts: { orderNo: 'WF-0171' },
    entityId: 's1',
  },
  'eta.updated': {
    payload: {
      stopId: 's1',
      orderId: 'o1',
      etaAt: '2026-10-02T01:40:00.000Z',
      slipMin: 20,
    },
    facts: { orderNo: 'WF-0171' },
    entityId: 's1',
  },
  'trip.cant_run': {
    payload: { tripId: 't1', reason: 'BREAKDOWN' },
    facts: { vehicleCode: 'DRY-31' },
    entityId: 't1',
  },
  'trip.reassigned': {
    payload: { tripId: 't1', vehicleChanged: true, driverId: 'u1' },
    facts: { vehicleCode: 'DRY-12', tripNo: 2, stops: 6 },
    entityId: 't1',
  },
};
