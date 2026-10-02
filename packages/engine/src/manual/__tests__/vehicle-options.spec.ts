import { describe, expect, it } from 'vitest';
import type { Plan, Trip } from '../../types';
import { vehicleOptions } from '../vehicle-options';
import { deepFreeze, fleetScenario, trip } from './scenarios';

const byCode = (options: ReturnType<typeof vehicleOptions>) => Object.fromEntries(options.map((o) => [o.code, o]));

describe('vehicleOptions', () => {
  it('vehicle-options: every vehicle shows trips left, minutes left, caps and fuel left, sorted by code (AC-PLN-15)', () => {
    const { input, plan } = fleetScenario();
    const options = vehicleOptions(input, plan);
    expect(options.map((o) => o.code)).toEqual(['DRY-12', 'DRY-31', 'REF-07', 'REF-11']);
    expect(byCode(options)['DRY-31']).toEqual({
      vehicleId: 'fx-veh-3', code: 'DRY-31', status: 'AVAILABLE', available: true, unavailableReason: null,
      tripsUsed: 0, tripsLeft: 2, nextTripNo: 1,
      freshMinutesLeft: 270, styleTechMinutesLeft: 480,
      weightCapKg: 1000, volumeCapM3: 10, fuelLeftL: 500,
    });
  });

  it('vehicle-options: a vehicle with two trips shows none left, and what the two trips used', () => {
    const { input, plan } = fleetScenario();
    expect(byCode(vehicleOptions(input, plan))['REF-07']).toMatchObject({
      status: 'NO_TRIPS_LEFT', tripsUsed: 2, tripsLeft: 0, nextTripNo: null,
      freshMinutesLeft: 166, // 270 minus two trips of 52
      fuelLeftL: 382.4, // 500, minus 100 used this week, minus two trips of 8.8
    });
  });

  it('vehicle-options: a vehicle in the workshop or broken down is unavailable, with the reason', () => {
    const { input, plan } = fleetScenario();
    const options = byCode(vehicleOptions(input, plan));
    expect(options['REF-11']).toMatchObject({ status: 'WORKSHOP', available: false, unavailableReason: 'WORKSHOP' });
    expect(options['DRY-12']).toMatchObject({ status: 'BREAKDOWN', available: false, unavailableReason: 'BREAKDOWN' });
  });

  it('vehicle-options: the next trip number is the smallest free slot', () => {
    const { input } = fleetScenario();
    const plan: Plan = { trips: [trip('fx-veh-3', 2, ['fx-ord-3'])], unplanned: [] };
    expect(byCode(vehicleOptions(input, plan))['DRY-31']).toMatchObject({ tripsUsed: 1, tripsLeft: 1, nextTripNo: 1 });
  });

  it('vehicle-options: fixed trips count towards trips, minutes and fuel', () => {
    const { input, plan } = fleetScenario();
    const fixed: Trip = {
      key: 'DRY-31#1', vehicleId: 'fx-veh-3', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha',
      orderIds: [], minutes: 100, km: 50, litres: 10, weightKg: 0, volumeM3: 0,
    };
    expect(byCode(vehicleOptions({ ...input, fixedTrips: [fixed] }, plan))['DRY-31']).toMatchObject({
      tripsUsed: 1, tripsLeft: 1, nextTripNo: 2, freshMinutesLeft: 170, fuelLeftL: 490,
    });
  });

  it('vehicle-options: Style and Tech minutes are counted apart from Fresh', () => {
    const { input } = fleetScenario();
    const plan: Plan = { trips: [trip('fx-veh-3', 1, ['fx-ord-5'], { brand: 'STYLE' })], unplanned: [] };
    expect(byCode(vehicleOptions(input, plan))['DRY-31']).toMatchObject({ freshMinutesLeft: 270, styleTechMinutesLeft: 428 });
  });

  it('vehicle-options: the budgets come from the params', () => {
    const { input, plan } = fleetScenario();
    const tight = { ...input, params: { freshBudgetMin: 200, maxTripsPerVehicle: 3 } };
    expect(byCode(vehicleOptions(tight, plan))['DRY-31']).toMatchObject({ freshMinutesLeft: 200, tripsLeft: 3 });
  });

  it('vehicle-options: it is pure and gives the same answer every time', () => {
    const { input, plan } = fleetScenario();
    deepFreeze(input);
    deepFreeze(plan);
    expect(vehicleOptions(input, plan)).toEqual(vehicleOptions(input, plan));
  });
});
