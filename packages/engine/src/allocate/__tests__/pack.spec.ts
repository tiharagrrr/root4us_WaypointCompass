import { describe, expect, it } from 'vitest';
import { allocate } from '../index';
import { validate } from '../../validate';
import { scenario, stopsByTrip } from './fixture';

describe('packing', () => {
  it('pack: an order joins the open trip where it fits best', () => {
    const input = scenario({
      vehicles: [
        { id: 'fx-veh-1', volumeCapM3: 2 },
        { id: 'fx-veh-2', volumeCapM3: 2 },
      ],
      orders: [
        { id: 'fx-ord-1', volumeM3: 1.2 },
        { id: 'fx-ord-2', volumeM3: 0.9 },
        { id: 'fx-ord-3', volumeM3: 0.7 },
      ],
    });
    // FO-1 opens FV1#1 (1.2 of 2). FO-2 does not fit there, so it opens FV2#1 (0.9 of 2).
    // FO-3 fits on both; the fuller trip wins, so slack is not scattered over two vehicles.
    expect(stopsByTrip(allocate(input).trips)).toEqual({
      'FV1#1': ['fx-ord-1', 'fx-ord-3'],
      'FV2#1': ['fx-ord-2'],
    });
  });

  it('pack: a new trip opens on the vehicle with the most budget and capacity left', () => {
    const input = scenario({
      vehicles: [
        { id: 'fx-veh-1', volumeCapM3: 1 },
        { id: 'fx-veh-2', volumeCapM3: 3 },
      ],
      orders: [{ id: 'fx-ord-1', volumeM3: 0.5 }],
    });
    expect(stopsByTrip(allocate(input).trips)).toEqual({ 'FV2#1': ['fx-ord-1'] });
  });

  it('pack: a second trip on the same vehicle takes what trip 1 cannot', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 1 }],
      orders: [
        { id: 'fx-ord-1', volumeM3: 0.6 },
        { id: 'fx-ord-2', volumeM3: 0.6 },
      ],
    });
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1'], 'FV1#2': ['fx-ord-2'] });
    expect(output.unplanned).toEqual([]);
  });

  it('pack: a capacity rule is checked before the order is placed, not only afterwards', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', weightCapKg: 100 }],
      orders: [
        { id: 'fx-ord-1', weightKg: 60 },
        { id: 'fx-ord-2', weightKg: 60 },
      ],
      params: { maxTripsPerVehicle: 1 },
    });
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1'] });
    // The order never joined the trip, so there is nothing for validate() to report.
    expect(output.violations).toEqual([]);
    expect(validate(input, output)).toEqual([]);
    expect(output.unplanned[0]).toMatchObject({ orderId: 'fx-ord-2', bindingRule: 'CAP_WEIGHT', reasonCode: 'OVER_CAPACITY' });
  });

  it('pack: the weekly fuel quota is checked before the order is placed', () => {
    // 44 km out and back, 5 km between stops, 1 km per litre: one stop costs 44 L, two 49, three 54.
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', kmPerL: 1, weeklyFuelQuotaL: 50 }],
      orders: [{ id: 'fx-ord-1' }, { id: 'fx-ord-2' }, { id: 'fx-ord-3' }],
    });
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1', 'fx-ord-2'] });
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-3',
      bindingRule: 'FUEL_WEEKLY',
      reasonCode: 'FUEL_QUOTA',
    });
    expect(output.violations).toEqual([]);
  });

  it('pack: a trip that would break the Fresh budget is refused with TIME_BUDGET', () => {
    // One stop costs 37 + 15 = 52 minutes, so a second trip would take the vehicle to 104.
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 0.5 }],
      orders: [
        { id: 'fx-ord-1', volumeM3: 0.4 },
        { id: 'fx-ord-2', volumeM3: 0.4 },
      ],
      params: { freshBudgetMin: 100 },
    });
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1'] });
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-2',
      bindingRule: 'BUDGET_FRESH',
      reasonCode: 'TIME_BUDGET',
    });
  });

  it('pack: a van-only outlet is served by a van, and a truck never takes it', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1' }, { id: 'fx-veh-2', type: 'VAN' }],
      outlets: { 'fx-out-1': { parkingConstraint: 'VAN_ONLY' }, 'fx-out-2': {} },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1' },
        { id: 'fx-ord-2', outletId: 'fx-out-2' },
      ],
    });
    const output = allocate(input);
    expect(output.trips.find((trip) => trip.orderIds.includes('fx-ord-1'))?.vehicleId).toBe('fx-veh-2');
    expect(output.violations).toEqual([]);
  });

  it('pack: with every van busy a van-only order waits with VAN_SHORTAGE', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1' }, { id: 'fx-veh-2', type: 'VAN', volumeCapM3: 0.5 }],
      outlets: { 'fx-out-1': { parkingConstraint: 'VAN_ONLY' } },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1', volumeM3: 0.4 },
        { id: 'fx-ord-2', outletId: 'fx-out-1', volumeM3: 0.4 },
        { id: 'fx-ord-3', outletId: 'fx-out-1', volumeM3: 0.4 },
      ],
    });
    const output = allocate(input);
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-3',
      bindingRule: 'ACCESS_VAN_ONLY',
      reasonCode: 'VAN_SHORTAGE',
    });
  });

  it('pack: an order whose window cannot be met waits with WINDOW_CONFLICT', () => {
    // The Fresh run leaves at 03:30 and reaches the district at 04:07; this outlet shuts at 04:00.
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: { 'fx-out-1': { windowOpenMin: 180, windowCloseMin: 240 } },
      orders: [{ id: 'fx-ord-1', outletId: 'fx-out-1' }],
    });
    const output = allocate(input);
    expect(output.trips).toEqual([]);
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-1',
      bindingRule: 'WINDOW_OUTLET',
      reasonCode: 'WINDOW_CONFLICT',
    });
    expect(output.violations).toEqual([]);
  });
});
