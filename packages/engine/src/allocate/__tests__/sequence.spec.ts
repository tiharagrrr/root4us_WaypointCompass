import { describe, expect, it } from 'vitest';
import { allocate } from '../index';
import { scenario, stopsByTrip } from './fixture';

describe('sequencing', () => {
  it('sequence: stops run in effective window close order', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: {
        'fx-out-1': { windowCloseMin: 700 },
        'fx-out-2': { windowCloseMin: 400 },
        'fx-out-3': { windowCloseMin: 550 },
      },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1' },
        { id: 'fx-ord-2', outletId: 'fx-out-2' },
        { id: 'fx-ord-3', outletId: 'fx-out-3' },
      ],
    });
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-2', 'fx-ord-3', 'fx-ord-1'] });
    expect(output.violations).toEqual([]);
  });

  it('sequence: a stop goes where it adds the least waiting while keeping every window', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: {
        // Closes first, but opens at 06:40, so going there first means waiting at the kerb.
        'fx-out-1': { windowOpenMin: 400, windowCloseMin: 500 },
        'fx-out-2': { windowOpenMin: 0, windowCloseMin: 600 },
      },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1' },
        { id: 'fx-ord-2', outletId: 'fx-out-2' },
      ],
    });
    // Window close order is FO-1 then FO-2, which waits 153 minutes; the other way round waits 129.
    expect(stopsByTrip(allocate(input).trips)).toEqual({ 'FV1#1': ['fx-ord-2', 'fx-ord-1'] });
    expect(allocate(input).violations).toEqual([]);
  });

  it('sequence: the stop order does not change the trip minutes', () => {
    const windows = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: {
        'fx-out-1': { windowOpenMin: 400, windowCloseMin: 500 },
        'fx-out-2': { windowCloseMin: 600 },
        'fx-out-3': { windowCloseMin: 700 },
      },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1' },
        { id: 'fx-ord-2', outletId: 'fx-out-2' },
        { id: 'fx-ord-3', outletId: 'fx-out-3' },
      ],
    });
    const plain = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      orders: [{ id: 'fx-ord-1' }, { id: 'fx-ord-2' }, { id: 'fx-ord-3' }],
    });
    // 37 out + 9 × 2 between + 15 × 3 handling, whichever order the stops come in.
    expect(allocate(windows).trips[0]?.minutes).toBe(100);
    expect(allocate(plain).trips[0]?.minutes).toBe(100);
    expect(stopsByTrip(allocate(windows).trips)).not.toEqual(stopsByTrip(allocate(plain).trips));
  });

  it('sequence: a mall window narrows the one the stop is sequenced by', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: {
        'fx-out-1': { windowCloseMin: 600 },
        // The outlet is open until 08:00 but the mall dock shuts at 05:00, so this stop goes first.
        'fx-out-2': {
          parkingConstraint: 'MALL_DOCK',
          dockType: 'MALL_BAY',
          windowCloseMin: 480,
          mallWindowOpenMin: 0,
          mallWindowCloseMin: 300,
        },
      },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1' },
        { id: 'fx-ord-2', outletId: 'fx-out-2' },
      ],
    });
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-2', 'fx-ord-1'] });
    expect(output.violations.filter((v) => v.severity === 'HARD')).toEqual([]);
  });
});
