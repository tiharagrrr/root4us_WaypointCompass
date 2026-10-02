import { describe, expect, it } from 'vitest';
import { EngineInputError } from '../../errors';
import type { Trip } from '../../types';
import { fits } from '../fits';
import { optionsForTrip } from '../order-options';
import { deepFreeze, fleetScenario } from './scenarios';

const REF_07 = 'fx-veh-1';
const REF_11_WORKSHOP = 'fx-veh-2';
const DRY_31 = 'fx-veh-3';

const ids = (options: { orderId: string }[]) => options.map((o) => o.orderId);

describe('optionsForTrip', () => {
  it('order-options: with no trip yet, each order is tried as a trip of its own, fits first (AC-PLN-15)', () => {
    const { input, plan } = fleetScenario();
    const options = optionsForTrip(input, plan, { vehicleId: DRY_31, tripNo: 1 });
    expect(options.map((o) => [o.orderId, o.status])).toEqual([
      ['fx-ord-3', 'FITS'],
      ['fx-ord-5', 'FITS'],
      ['fx-ord-4', 'BLOCKED'],
    ]);
    const chilled = options.find((o) => o.orderId === 'fx-ord-4');
    expect(chilled?.blocking[0]).toMatchObject({ rule: 'TEMP_REEFER', message: 'FO-4 is chilled but DRY-31 is not a reefer' });
  });

  it('order-options: an option carries the order, its priority and the trip totals with it added', () => {
    const { input, plan } = fleetScenario();
    const option = optionsForTrip(input, plan, { vehicleId: DRY_31, tripNo: 1 }).find((o) => o.orderId === 'fx-ord-3');
    expect(option).toMatchObject({ ref: 'FO-3', priority: 15, warnings: [], result: { weightKg: 10, volumeM3: 0.1, minutes: 52, litres: 8.8 } });
  });

  it('order-options: a vehicle that already has two trips blocks every order with TRIP_LIMIT', () => {
    const { input, plan } = fleetScenario();
    const options = optionsForTrip(input, plan, { vehicleId: REF_07, tripNo: 3 });
    expect(options).toHaveLength(3);
    for (const o of options) {
      expect(o.status).toBe('BLOCKED');
      expect(o.blocking.map((v) => v.rule)).toContain('TRIP_LIMIT');
    }
  });

  it('order-options: a vehicle in the workshop blocks every order, with the reason', () => {
    const { input, plan } = fleetScenario();
    const options = optionsForTrip(input, plan, { vehicleId: REF_11_WORKSHOP, tripNo: 1 });
    for (const o of options) expect(o.blocking[0]).toMatchObject({ rule: 'VEHICLE_AVAILABLE', message: 'REF-11 is not available (WORKSHOP)' });
  });

  it('order-options: the first chosen order fixes the trip brand and district for the rest', () => {
    const { input, plan } = fleetScenario();
    const options = optionsForTrip(input, plan, { vehicleId: DRY_31, tripNo: 1, selectedOrderIds: ['fx-ord-3'] });
    expect(options.map((o) => [o.orderId, o.status, o.blocking[0]?.rule])).toEqual([
      ['fx-ord-4', 'BLOCKED', 'TEMP_REEFER'],
      ['fx-ord-5', 'BLOCKED', 'TRIP_BRAND_DISTRICT'],
    ]);
  });

  it('order-options: on a trip that already exists, the orders are checked against what is on it', () => {
    const { input, plan } = fleetScenario();
    const options = optionsForTrip(input, plan, { vehicleId: REF_07, tripNo: 1 });
    expect(options.map((o) => [o.orderId, o.status])).toEqual([
      ['fx-ord-4', 'FITS'],
      ['fx-ord-3', 'FITS'],
      ['fx-ord-5', 'BLOCKED'],
    ]);
    expect(options[2]?.blocking[0]?.rule).toBe('TRIP_BRAND_DISTRICT');
  });

  it("order-options: a blocked option carries exactly the violations fits() gives", () => {
    const { input, plan } = fleetScenario();
    for (const o of optionsForTrip(input, plan, { vehicleId: REF_07, tripNo: 1 })) {
      const direct = fits(input, plan, o.orderId, 'REF-07#1');
      expect(o.blocking).toEqual(direct.blocking);
      expect(o.warnings).toEqual(direct.warnings);
      expect(o.result).toEqual(direct.result);
    }
  });

  it('order-options: orders already on a trip, planned or fixed, are not offered', () => {
    const { input, plan } = fleetScenario();
    const fixed: Trip = {
      key: 'DRY-12#1', vehicleId: 'fx-veh-4', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha',
      orderIds: ['fx-ord-3'], minutes: 52, km: 44, litres: 8.8, weightKg: 10, volumeM3: 0.1,
    };
    const options = optionsForTrip({ ...input, fixedTrips: [fixed] }, plan, { vehicleId: DRY_31, tripNo: 1 });
    expect(ids(options).sort()).toEqual(['fx-ord-4', 'fx-ord-5']);
  });

  it('order-options: within a status the higher priority comes first, then the earlier window, then the ref', () => {
    const { input, plan } = fleetScenario();
    const urgent = { ...input, orders: input.orders.map((o) => (o.id === 'fx-ord-5' ? { ...o, urgent: true, brand: 'FRESH' as const } : o)) };
    const options = optionsForTrip(urgent, plan, { vehicleId: DRY_31, tripNo: 1 });
    // o5 is now fresh and urgent (23), o3 is fresh (15).
    expect(ids(options).slice(0, 2)).toEqual(['fx-ord-5', 'fx-ord-3']);
  });

  it('order-options: an unknown vehicle or order is an input error naming the field', () => {
    const { input, plan } = fleetScenario();
    const run = (target: Parameters<typeof optionsForTrip>[2]) => {
      try {
        optionsForTrip(input, plan, target);
      } catch (e) {
        expect(e).toBeInstanceOf(EngineInputError);
        return e as EngineInputError;
      }
      throw new Error('expected an EngineInputError');
    };
    expect(run({ vehicleId: 'nope', tripNo: 1 })).toMatchObject({ code: 'UNKNOWN_VEHICLE', field: 'target.vehicleId', value: 'nope' });
    expect(run({ vehicleId: DRY_31, tripNo: 1, selectedOrderIds: ['nope'] })).toMatchObject({ code: 'UNKNOWN_ORDER', field: 'target.selectedOrderIds[0]' });
    expect(run({ vehicleId: DRY_31, tripNo: 1, selectedOrderIds: ['fx-ord-1'] })).toMatchObject({ code: 'ORDER_ALREADY_ASSIGNED', field: 'target.selectedOrderIds[0]' });
  });

  it('order-options: it is pure and gives the same answer every time', () => {
    const { input, plan } = fleetScenario();
    deepFreeze(input);
    deepFreeze(plan);
    const a = optionsForTrip(input, plan, { vehicleId: DRY_31, tripNo: 1 });
    expect(optionsForTrip(input, plan, { vehicleId: DRY_31, tripNo: 1 })).toEqual(a);
  });
});
