import { describe, expect, it } from 'vitest';
import { allocate } from '../index';
import { scenario, stopsByTrip, type ScenarioSpec } from './fixture';

/**
 * TEMP_REEFER only forbids a chilled order on a vehicle that is not a reefer; a reefer may carry
 * ambient orders. Which of them it should carry is the allocator's choice, and these cases pin it:
 * chilled orders first, then a high-priority ambient order nothing else can take, then spare reefer
 * room once every chilled order has had its turn (specs/engine/rules.md, TEMP_REEFER).
 *
 * The ambient truck is too small for the ambient order, so "no ambient vehicle can take it" is true
 * by construction, and the reefer holds one order of 0.8 m³ at a time.
 */
const oneReeferOneSmallTruck = (
  reeferVolumeCapM3: number,
  history: ScenarioSpec['history'] = {},
  params: ScenarioSpec['params'] = {},
) =>
  scenario({
    vehicles: [
      { id: 'fx-veh-1', temp: 'REEFER', volumeCapM3: reeferVolumeCapM3 },
      { id: 'fx-veh-2', volumeCapM3: 0.5 },
    ],
    outlets: { 'fx-out-1': {}, 'fx-out-2': {} },
    orders: [
      { id: 'fx-ord-1', outletId: 'fx-out-1', volumeM3: 0.8 },
      { id: 'fx-ord-2', outletId: 'fx-out-2', volumeM3: 0.8, tempClass: 'CHILLED' },
    ],
    history,
    params: { maxTripsPerVehicle: 1, ...params },
  });

/** 40 for yesterday's deferral + 10 for one in a row + 15 Fresh = 65, past the 40 the gate asks for. */
const deferredYesterday = {
  'fx-out-1': { deferredOnLastRun: true, consecutiveDeferrals: 1, daysSinceLastServed: 0 },
};

describe('temperature preference', () => {
  it('allocate: a chilled order rides the reefer and an ambient order its own vehicle', () => {
    const input = scenario({
      vehicles: [
        { id: 'fx-veh-1', temp: 'REEFER', volumeCapM3: 2 },
        { id: 'fx-veh-2', volumeCapM3: 2 },
      ],
      outlets: { 'fx-out-1': {}, 'fx-out-2': {} },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1', volumeM3: 0.5 },
        { id: 'fx-ord-2', outletId: 'fx-out-2', volumeM3: 0.5, tempClass: 'CHILLED' },
      ],
    });
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-2'], 'FV2#1': ['fx-ord-1'] });
    expect(output.unplanned).toEqual([]);
  });

  it('allocate: a reefer takes a high-priority ambient order no ambient vehicle can carry', () => {
    const output = allocate(oneReeferOneSmallTruck(1, deferredYesterday));
    // The ambient order was deferred yesterday and the truck is too small, so it takes the reefer and
    // the chilled order, with no history of its own, is the one that waits.
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1'] });
    // The last vehicle tried for it was the ambient truck, which cannot carry chilled goods at all,
    // so the reason reads as the reefer being full, which is what happened.
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-2',
      reasonCode: 'NO_REEFER_CAPACITY',
      bindingRule: 'TEMP_REEFER',
      choice: 'UNAVOIDABLE',
    });
  });

  it('allocate: an ambient order with no claim on a reefer gives way to a chilled order', () => {
    const output = allocate(oneReeferOneSmallTruck(1));
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-2'] });
    expect(output.unplanned[0]).toMatchObject({ orderId: 'fx-ord-1', choice: 'UNAVOIDABLE' });
  });

  it('allocate: a reefer takes an ambient order once every chilled order is placed', () => {
    const output = allocate(oneReeferOneSmallTruck(2));
    // Room for both: the chilled order has its turn first, then the spare reefer room goes to the
    // ambient order rather than sitting empty.
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1', 'fx-ord-2'] });
    expect(output.trips[0]?.vehicleId).toBe('fx-veh-1');
    expect(output.unplanned).toEqual([]);
  });

  it('allocate: with reeferCarriesAmbient off an ambient order never rides a reefer', () => {
    const output = allocate(oneReeferOneSmallTruck(2, {}, { reeferCarriesAmbient: false }));
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-2'] });
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-1',
      bindingRule: 'TEMP_REEFER',
      reasonCode: 'NO_REEFER_CAPACITY',
    });
  });
});
