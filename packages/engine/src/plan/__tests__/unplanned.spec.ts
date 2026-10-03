import { describe, expect, it } from 'vitest';
import type { Trip } from '../../types';
import { capacityScenario, deepFreeze } from '../../manual/__tests__/scenarios';
import { unplannedOrders } from '../unplanned';

describe('unplannedOrders: an order that is on no trip', () => {
  it('unplanned: lists the orders on no trip, sorted by id', () => {
    const { input, plan } = capacityScenario();
    expect(unplannedOrders(input, plan).map((o) => o.id)).toEqual(['fx-ord-4', 'fx-ord-5']);
  });

  it('unplanned: an order on a fixed (released or in-progress) trip is on a trip', () => {
    const { input, plan } = capacityScenario();
    const fixed: Trip = {
      key: 'REF-11#1', vehicleId: 'fx-veh-3', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha',
      orderIds: ['fx-ord-4'], minutes: 52, km: 44, litres: 8.8, weightKg: 10, volumeM3: 0.5,
    };
    expect(unplannedOrders({ ...input, fixedTrips: [fixed] }, plan).map((o) => o.id)).toEqual(['fx-ord-5']);
  });

  it('unplanned: an order already on plan.unplanned is still on no trip', () => {
    const { input, plan } = capacityScenario();
    const listed = { orderId: 'fx-ord-4', reasonCode: 'OVER_CAPACITY', bindingRule: 'CAP_VOLUME', choice: 'UNAVOIDABLE', priority: 25, repeatSkip: false } as const;
    expect(unplannedOrders(input, { ...plan, unplanned: [listed] }).map((o) => o.id)).toContain('fx-ord-4');
  });

  it('unplanned: a plan with no trips leaves every order unplanned', () => {
    const { input } = capacityScenario();
    expect(unplannedOrders(input, { trips: [], unplanned: [] })).toHaveLength(input.orders.length);
  });

  it('unplanned: it does not change its input', () => {
    const { input, plan } = capacityScenario();
    deepFreeze(input);
    deepFreeze(plan);
    expect(() => unplannedOrders(input, plan)).not.toThrow();
  });
});
