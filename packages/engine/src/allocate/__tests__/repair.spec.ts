import { describe, expect, it } from 'vitest';
import { allocate } from '../index';
import { validate } from '../../validate';
import { scenario, stopsByTrip, type ScenarioSpec } from './fixture';

/**
 * One reefer and nothing else, so the ambient group looks the scarcest and is packed first: a
 * high-priority ambient order takes the reefer before the chilled order has had its turn. The chilled
 * order then has to make room for itself, which is what repair is for.
 */
const contendedReefer = (chilledHistory: ScenarioSpec['history'], params: ScenarioSpec['params'] = {}) =>
  scenario({
    vehicles: [{ id: 'fx-veh-1', temp: 'REEFER', volumeCapM3: 1 }],
    outlets: { 'fx-out-1': {}, 'fx-out-2': {} },
    orders: [
      { id: 'fx-ord-1', outletId: 'fx-out-1', volumeM3: 0.6 },
      { id: 'fx-ord-2', outletId: 'fx-out-2', volumeM3: 0.5, tempClass: 'CHILLED' },
    ],
    history: {
      // 40 for yesterday's deferral + 10 for one in a row + 15 Fresh = 65.
      'fx-out-1': { deferredOnLastRun: true, consecutiveDeferrals: 1, daysSinceLastServed: 0 },
      ...chilledHistory,
    },
    params: { maxTripsPerVehicle: 1, ...params },
  });

/** 40 + 3 × 10 + 2 × 10 + 15 Fresh + 10 chilled = 115, so this order outranks the ambient one. */
const deferredThreeRuns = {
  'fx-out-2': { deferredOnLastRun: true, consecutiveDeferrals: 3, daysSinceLastServed: 10 },
};

describe('repair', () => {
  it('repair: a lower-priority order is swapped out and recorded as PRIORITY_CHOICE', () => {
    const input = contendedReefer(deferredThreeRuns);
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-2'] });
    expect(output.unplanned).toHaveLength(1);
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-1',
      choice: 'PRIORITY_CHOICE',
      displacedBy: 'fx-ord-2',
      priority: 65,
      repeatSkip: true,
      reasonCode: 'OVER_CAPACITY',
      bindingRule: 'CAP_VOLUME',
    });
    expect(validate(input, output).filter((v) => v.severity === 'HARD')).toEqual([]);
  });

  it('repair: an order already deferred on its last run is not displaced by a lower score', () => {
    // The chilled order has no history, so it scores 25 against the ambient order's 65.
    const input = contendedReefer({});
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1'] });
    expect(output.unplanned).toHaveLength(1);
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-2',
      choice: 'UNAVOIDABLE',
      priority: 25,
    });
    expect(output.unplanned[0]?.displacedBy).toBeUndefined();
  });

  it('repair: a displaced order that finds another trip is a move, not a deferral', () => {
    const input = scenario({
      vehicles: [
        { id: 'fx-veh-1', temp: 'REEFER', volumeCapM3: 1 },
        { id: 'fx-veh-2', temp: 'REEFER', volumeCapM3: 0.7 },
      ],
      outlets: { 'fx-out-1': {}, 'fx-out-2': {} },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1', volumeM3: 0.6 },
        { id: 'fx-ord-2', outletId: 'fx-out-2', volumeM3: 0.9, tempClass: 'CHILLED' },
      ],
      history: {
        'fx-out-1': { deferredOnLastRun: true, consecutiveDeferrals: 1, daysSinceLastServed: 0 },
        ...deferredThreeRuns,
      },
      params: { maxTripsPerVehicle: 1 },
    });
    const output = allocate(input);
    // The chilled order takes the big reefer; the ambient order moves to the small one.
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-2'], 'FV2#1': ['fx-ord-1'] });
    expect(output.unplanned).toEqual([]);
  });

  it('repair: it stops after improveIterations moves', () => {
    const output = allocate(contendedReefer(deferredThreeRuns, { improveIterations: 1 }));
    // The one move it was allowed went on trying to place the order; the swap never happened.
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1'] });
    expect(output.unplanned[0]).toMatchObject({ orderId: 'fx-ord-2', choice: 'UNAVOIDABLE' });
  });

  it('repair: a plan that needs no repair is left exactly as the packer left it', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 2 }],
      orders: [{ id: 'fx-ord-1', volumeM3: 0.5 }, { id: 'fx-ord-2', volumeM3: 0.5 }],
    });
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1', 'fx-ord-2'] });
    expect(output.unplanned).toEqual([]);
  });
});
