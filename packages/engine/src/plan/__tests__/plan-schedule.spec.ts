import { describe, expect, it } from 'vitest';
import { allocate } from '../../index';
import { capacityScenario, deepFreeze } from '../../manual/__tests__/scenarios';
import { planSchedule } from '../plan-schedule';

describe('planSchedule', () => {
  it('measures each trip and times each stop, as the rules see them', () => {
    const { input, plan } = capacityScenario();
    const trips = planSchedule(deepFreeze(input), deepFreeze(plan));
    const first = trips.find((t) => t.key === 'REF-07#1');
    const district = input.districts['fx-gampaha'];
    if (!first || !district) throw new Error('scenario changed');

    expect(first).toMatchObject({
      key: 'REF-07#1',
      vehicleId: 'fx-veh-1',
      tripNo: 1,
      orderIds: ['fx-ord-1', 'fx-ord-2'],
      volumeM3: 11.5,
    });
    expect(first.departMin).toBe(210); // the Fresh start
    expect(first.stops.map((s) => s.orderId)).toEqual(['fx-ord-1', 'fx-ord-2']);

    // The first leg is the depot-to-district time; later legs the inter-stop time.
    const [a, b] = first.stops;
    if (!a || !b) throw new Error('scenario changed');
    expect(a.travelMin).toBe(district.depotToDistrictMin);
    expect(a.arriveMin).toBe(210 + district.depotToDistrictMin);
    expect(b.travelMin).toBe(district.interStopMin);
    expect(b.arriveMin).toBe(a.finishMin + district.interStopMin);
    expect(a.finishMin - a.startMin).toBe(a.serviceMin);
    expect(a.windowCloseMin).toBeGreaterThan(a.windowOpenMin);
    expect(first.returnMin).toBe(b.finishMin + district.depotToDistrictMin);

    expect(trips.map((t) => t.key)).toEqual(['REF-03#1', 'REF-07#1']);
  });

  it('is sorted by trip key and leaves out fixed trips', () => {
    const { input, plan } = capacityScenario();
    const keys = planSchedule(input, { ...plan, trips: [...plan.trips].reverse() }).map((t) => t.key);
    expect(keys).toEqual(['REF-03#1', 'REF-07#1']);
  });

  it('is exported with allocate() for the API', () => {
    expect(typeof allocate).toBe('function');
  });
});
