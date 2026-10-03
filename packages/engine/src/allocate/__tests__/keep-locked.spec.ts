import { describe, expect, it } from 'vitest';
import { allocate } from '../index';
import { validate } from '../../validate';
import { scenario, stopsByTrip } from './fixture';

/** A trip a dispatcher built by hand, with its stops in an order the sequencer would not choose. */
const handBuilt = () =>
  scenario({
    vehicles: [{ id: 'fx-veh-1', volumeCapM3: 2 }, { id: 'fx-veh-2', volumeCapM3: 2 }],
    outlets: {
      'fx-out-1': { windowCloseMin: 700 },
      'fx-out-2': { windowCloseMin: 400 },
      'fx-out-3': {},
    },
    orders: [
      { id: 'fx-ord-1', outletId: 'fx-out-1', volumeM3: 0.5 },
      { id: 'fx-ord-2', outletId: 'fx-out-2', volumeM3: 0.5 },
      { id: 'fx-ord-3', outletId: 'fx-out-3', volumeM3: 0.5 },
    ],
    lockedTrips: [
      {
        key: 'FV1#1',
        vehicleId: 'fx-veh-1',
        tripNo: 1,
        brand: 'FRESH',
        districtId: 'fx-gampaha',
        orderIds: ['fx-ord-1', 'fx-ord-2'],
      },
    ],
  });

describe('keepLocked and reservations', () => {
  it('allocate: keepLocked keeps a hand-built trip’s vehicle, trip number and stops', () => {
    const input = handBuilt();
    const output = allocate(input, { keepLocked: true });
    // The sequencer would put FO-2 first, its window closing earlier; the hand-built order stands.
    expect(stopsByTrip(output.trips)).toEqual({
      'FV1#1': ['fx-ord-1', 'fx-ord-2'],
      'FV2#1': ['fx-ord-3'],
    });
    expect(output.trips.find((trip) => trip.key === 'FV1#1')?.locked).toBe(true);
    expect(output.unplanned).toEqual([]);
    expect(validate(input, output).filter((v) => v.severity === 'HARD')).toEqual([]);
  });

  it('allocate: a hand-built trip is not added to, and the rest is planned around it', () => {
    const input = handBuilt();
    const output = allocate(input, { keepLocked: true });
    expect(output.trips.find((trip) => trip.key === 'FV1#1')?.orderIds).toEqual([
      'fx-ord-1',
      'fx-ord-2',
    ]);
    // FO-3 would have fitted on the locked trip (1.5 of 2 m³), but it opens its own instead.
    expect(output.trips).toHaveLength(2);
  });

  it('allocate: without keepLocked a hand-built trip is replaced and its orders planned again', () => {
    const input = handBuilt();
    const output = allocate(input);
    expect(output.trips.every((trip) => trip.locked === undefined)).toBe(true);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-2', 'fx-ord-1', 'fx-ord-3'] });
    expect(output.unplanned).toEqual([]);
  });

  it('allocate: a reserved trip is filled before a new trip opens', () => {
    const input = scenario({
      // FV1 has the most capacity, so a new trip would go there; the reservation on FV2 wins.
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 10 }, { id: 'fx-veh-2', volumeCapM3: 2 }],
      orders: [{ id: 'fx-ord-1', volumeM3: 0.5 }],
      reservedTrips: [
        { vehicleId: 'fx-veh-2', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha', orderIds: [] },
      ],
    });
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV2#1': ['fx-ord-1'] });
    expect(output.trips[0]?.reserved).toBe(true);
  });

  it('allocate: a reservation nobody fills keeps its trip slot', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 2 }],
      orders: [{ id: 'fx-ord-1', tempClass: 'CHILLED' }],
      reservedTrips: [
        { vehicleId: 'fx-veh-1', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha', orderIds: [] },
      ],
    });
    const output = allocate(input);
    // The chilled order needs a reefer, so the reservation stays empty, and it still holds its slot.
    expect(output.trips).toHaveLength(1);
    expect(output.trips[0]).toMatchObject({ key: 'FV1#1', orderIds: [], minutes: 0, reserved: true });
    expect(output.unplanned[0]).toMatchObject({ orderId: 'fx-ord-1', bindingRule: 'TEMP_REEFER' });
  });

  it('allocate: a reservation is counted against the trip limit', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 0.5 }],
      orders: [
        { id: 'fx-ord-1', volumeM3: 0.4 },
        { id: 'fx-ord-2', volumeM3: 0.4 },
      ],
      reservedTrips: [
        { vehicleId: 'fx-veh-1', tripNo: 2, brand: 'STYLE', districtId: 'fx-gampaha', orderIds: [] },
      ],
    });
    const output = allocate(input);
    // Trip 2 is reserved for Style, so the second Fresh order has no slot of its own to open and
    // the only trip it could join is full. The fleet is what ran out, so the reason is OVER_CAPACITY.
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1'], 'FV1#2': [] });
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-2',
      bindingRule: 'CAP_VOLUME',
      reasonCode: 'OVER_CAPACITY',
    });
    expect(output.trips.find((trip) => trip.key === 'FV1#2')).toMatchObject({ reserved: true, orderIds: [] });
    expect(validate(input, output).filter((v) => v.severity === 'HARD')).toEqual([]);
  });
});
