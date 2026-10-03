import { describe, expect, it } from 'vitest';
import { allocate, type AllocateOptions } from '../index';
import type { EngineInput } from '../../types';
import { validate } from '../../validate';
import { ENGINE_VERSION } from '../../version';
import { scenario, shuffled, stopsByTrip } from './fixture';

/** Three chilled and three ambient orders, one reefer and one ambient truck: a day that just fits. */
const tightDay = () =>
  scenario({
    vehicles: [
      { id: 'fx-veh-1', temp: 'REEFER', volumeCapM3: 2 },
      { id: 'fx-veh-2', volumeCapM3: 2 },
    ],
    outlets: { 'fx-out-1': {}, 'fx-out-2': {} },
    orders: [
      { id: 'fx-ord-1', tempClass: 'CHILLED', volumeM3: 0.8, outletId: 'fx-out-1' },
      { id: 'fx-ord-2', tempClass: 'CHILLED', volumeM3: 0.8, outletId: 'fx-out-2' },
      { id: 'fx-ord-3', tempClass: 'CHILLED', volumeM3: 0.8, outletId: 'fx-out-1' },
      { id: 'fx-ord-4', volumeM3: 0.8, outletId: 'fx-out-1' },
      { id: 'fx-ord-5', volumeM3: 0.8, outletId: 'fx-out-2' },
      { id: 'fx-ord-6', volumeM3: 0.8, outletId: 'fx-out-1' },
    ],
  });

/** The same day with more ambient orders than the fleet can carry, so deferrals and a swap happen. */
const overSubscribedDay = () =>
  scenario({
    vehicles: [
      { id: 'fx-veh-1', temp: 'REEFER', volumeCapM3: 1.6 },
      { id: 'fx-veh-2', volumeCapM3: 1.8 },
    ],
    outlets: { 'fx-out-1': { windowCloseMin: 700 }, 'fx-out-2': { windowCloseMin: 400 } },
    orders: [
      { id: 'fx-ord-1', tempClass: 'CHILLED', volumeM3: 0.8, outletId: 'fx-out-1' },
      { id: 'fx-ord-2', tempClass: 'CHILLED', volumeM3: 0.8, outletId: 'fx-out-2' },
      { id: 'fx-ord-3', tempClass: 'CHILLED', volumeM3: 0.8, outletId: 'fx-out-1' },
      { id: 'fx-ord-4', volumeM3: 0.9, outletId: 'fx-out-1' },
      { id: 'fx-ord-5', volumeM3: 0.9, outletId: 'fx-out-2' },
      { id: 'fx-ord-6', volumeM3: 0.9, outletId: 'fx-out-1' },
      { id: 'fx-ord-7', volumeM3: 0.9, outletId: 'fx-out-2', urgent: true },
      // One order more than the two vehicles can carry over their four trips.
      { id: 'fx-ord-8', volumeM3: 0.9, outletId: 'fx-out-1' },
    ],
    history: {
      'fx-out-2': { deferredOnLastRun: true, consecutiveDeferrals: 2, daysSinceLastServed: 4 },
    },
  });

const reservedDay = () =>
  scenario({
    vehicles: [{ id: 'fx-veh-1', volumeCapM3: 10 }, { id: 'fx-veh-2', volumeCapM3: 2 }],
    outlets: { 'fx-out-1': {}, 'fx-out-2': {} },
    orders: [
      { id: 'fx-ord-1', volumeM3: 0.5, outletId: 'fx-out-1' },
      { id: 'fx-ord-2', volumeM3: 0.5, outletId: 'fx-out-2' },
    ],
    reservedTrips: [
      { vehicleId: 'fx-veh-2', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha', orderIds: [] },
    ],
  });

const lockedDay = () =>
  scenario({
    vehicles: [{ id: 'fx-veh-1', volumeCapM3: 2 }, { id: 'fx-veh-2', volumeCapM3: 2 }],
    outlets: { 'fx-out-1': {}, 'fx-out-2': {}, 'fx-out-3': {} },
    orders: [
      { id: 'fx-ord-1', volumeM3: 0.5, outletId: 'fx-out-1' },
      { id: 'fx-ord-2', volumeM3: 0.5, outletId: 'fx-out-2' },
      { id: 'fx-ord-3', volumeM3: 0.5, outletId: 'fx-out-3' },
    ],
    lockedTrips: [
      {
        key: 'FV1#1',
        vehicleId: 'fx-veh-1',
        tripNo: 1,
        brand: 'FRESH',
        districtId: 'fx-gampaha',
        orderIds: ['fx-ord-2', 'fx-ord-1'],
      },
    ],
  });

describe('allocate', () => {
  it('allocate: validate(allocate(x)) holds no HARD violation', () => {
    const input = tightDay();
    const output = allocate(input);
    expect(validate(input, output).filter((v) => v.severity === 'HARD')).toEqual([]);
    expect(output.violations.filter((v) => v.severity === 'HARD')).toEqual([]);
  });

  it('allocate: every order is on exactly one trip or unplanned with a reason', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 1 }],
      orders: [
        { id: 'fx-ord-1', volumeM3: 0.6 },
        { id: 'fx-ord-2', volumeM3: 0.6 },
        { id: 'fx-ord-3', volumeM3: 0.6 },
      ],
    });
    const output = allocate(input);
    const planned = output.trips.flatMap((trip) => [...trip.orderIds]);
    const deferred = output.unplanned.map((u) => u.orderId);
    expect([...planned, ...deferred].sort()).toEqual(['fx-ord-1', 'fx-ord-2', 'fx-ord-3']);
    expect(planned.filter((id) => deferred.includes(id))).toEqual([]);
    // Two trips of 0.6 m³ each on a 1 m³ vehicle; the third order has nowhere to go.
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-1'], 'FV1#2': ['fx-ord-2'] });
    expect(output.unplanned).toHaveLength(1);
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-3',
      reasonCode: 'OVER_CAPACITY',
      bindingRule: 'CAP_VOLUME',
      choice: 'UNAVOIDABLE',
      repeatSkip: false,
    });
  });

  it('allocate: shuffled input gives byte-identical output', () => {
    // Every list reversed and every table's keys reversed, on a day that fills up, one that runs out
    // of room, one with a reservation and one with a hand-built trip the run keeps.
    const days: { name: string; input: EngineInput; options?: AllocateOptions }[] = [
      { name: 'fits', input: tightDay() },
      { name: 'runs out', input: overSubscribedDay() },
      { name: 'reserved', input: reservedDay() },
      { name: 'locked', input: lockedDay(), options: { keepLocked: true } },
    ];
    for (const day of days) {
      expect(JSON.stringify(allocate(shuffled(day.input), day.options)), day.name).toBe(
        JSON.stringify(allocate(day.input, day.options)),
      );
    }
  });

  it('allocate: the same input run twice gives byte-identical output', () => {
    const input = tightDay();
    expect(JSON.stringify(allocate(input))).toBe(JSON.stringify(allocate(tightDay())));
  });

  it('allocate: a day that runs out of room still breaks no HARD rule and explains itself', () => {
    const input = overSubscribedDay();
    const output = allocate(input);
    expect(validate(input, output).filter((v) => v.severity === 'HARD')).toEqual([]);
    const planned = output.trips.flatMap((trip) => [...trip.orderIds]);
    expect([...planned, ...output.unplanned.map((u) => u.orderId)].sort()).toEqual(
      input.orders.map((order) => order.id).sort(),
    );
    expect(output.unplanned.length).toBeGreaterThan(0);
    for (const waiting of output.unplanned) {
      expect(waiting.reasonCode).toBeTruthy();
      expect(waiting.bindingRule).not.toBeNull();
      expect(waiting.detail).toBeDefined();
    }
  });

  it('allocate: the output carries the engine version and the plan date', () => {
    const output = allocate(tightDay());
    expect(output.version).toBe(ENGINE_VERSION);
    expect(output.date).toBe('2026-10-02');
  });

  it('allocate: a Fresh trip 1 leaves at the Fresh start and trip 2 after it returns', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 1 }],
      orders: [
        { id: 'fx-ord-1', volumeM3: 0.6 },
        { id: 'fx-ord-2', volumeM3: 0.6 },
      ],
    });
    const trips = allocate(input).trips;
    // 03:30 out, 37 minutes to the district, 15 at the stop, 37 back, 30 to reload: 03:30 then 05:29.
    expect(trips.map((t) => t.departMin)).toEqual([210, 329]);
  });

  it('allocate: a not-due Style order is excluded with NOT_DUE_TODAY, not deferred', () => {
    const input = scenario({
      // 2026-10-02 is a Friday, day 4; this outlet takes Style on Mondays.
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: { 'fx-out-1': { styleDeliveryDow: 0 }, 'fx-out-2': { styleDeliveryDow: 4 } },
      orders: [
        { id: 'fx-ord-1', brand: 'STYLE', outletId: 'fx-out-1' },
        { id: 'fx-ord-2', brand: 'STYLE', outletId: 'fx-out-2' },
      ],
    });
    const output = allocate(input);
    expect(output.excluded).toEqual([
      {
        orderId: 'fx-ord-1',
        code: 'NOT_DUE_TODAY',
        message: "FO-1 is a Style order for day 0, not the plan's day 4",
      },
    ]);
    expect(output.unplanned).toEqual([]);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#1': ['fx-ord-2'] });
    expect(validate(input, output).filter((v) => v.severity === 'HARD')).toEqual([]);
  });

  it('allocate: a day the depot does not run plans nothing and says so once', () => {
    const input = scenario({
      isOperatingDay: false,
      vehicles: [{ id: 'fx-veh-1' }],
      orders: [{ id: 'fx-ord-1' }],
    });
    const output = allocate(input);
    expect(output.trips).toEqual([]);
    expect(output.unplanned).toEqual([]);
    expect(output.excluded).toEqual([
      {
        orderId: 'fx-ord-1',
        code: 'NOT_AN_OPERATING_DAY',
        message: 'FO-1 is not planned: 2026-10-02 is not an operating day',
      },
    ]);
    expect(output.violations).toEqual([
      {
        rule: 'OPERATING_DAY',
        severity: 'HARD',
        scope: 'plan',
        message: '2026-10-02 is not an operating day',
      },
    ]);
  });

  it('allocate: an unplanned order carries the numbers, the vehicles tried and its priority', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 1 }, { id: 'fx-veh-2', volumeCapM3: 1 }],
      orders: [
        { id: 'fx-ord-1', volumeM3: 0.7, units: 4 },
        { id: 'fx-ord-2', volumeM3: 0.7, units: 4 },
        { id: 'fx-ord-3', volumeM3: 0.7, units: 4 },
        { id: 'fx-ord-4', volumeM3: 0.7, units: 4 },
        { id: 'fx-ord-5', volumeM3: 0.7, units: 6 },
      ],
      history: { 'fx-out-1': { deferredOnLastRun: true, consecutiveDeferrals: 1, daysSinceLastServed: 3 } },
    });
    const output = allocate(input);
    expect(output.unplanned).toHaveLength(1);
    const waiting = output.unplanned[0];
    expect(waiting?.detail).toEqual({
      needUnits: 6,
      needWeightKg: 10,
      needVolumeM3: 0.7,
      bestVolumeM3: 0.3,
      bestTripKey: 'FV1#1',
      bestVehicleId: 'fx-veh-1',
      bestTripNo: 1,
    });
    // Every order is at fx-out-1, which was deferred on its last run: 40 + 10 + 2 × 3 + 15 Fresh.
    expect(waiting?.priority).toBe(71);
    expect(waiting?.repeatSkip).toBe(true);
    expect(waiting?.tried).toEqual([
      { vehicleId: 'fx-veh-1', failedRule: 'CAP_VOLUME' },
      { vehicleId: 'fx-veh-2', failedRule: 'CAP_VOLUME' },
    ]);
  });

  it('allocate: a chilled order with every reefer in the workshop gets NO_REEFER_CAPACITY', () => {
    const input = scenario({
      vehicles: [
        { id: 'fx-veh-1', temp: 'REEFER', available: false, unavailableReason: 'WORKSHOP' },
        { id: 'fx-veh-2' },
      ],
      orders: [{ id: 'fx-ord-1', tempClass: 'CHILLED' }],
    });
    const output = allocate(input);
    expect(output.trips).toEqual([]);
    expect(output.unplanned[0]).toMatchObject({
      orderId: 'fx-ord-1',
      reasonCode: 'NO_REEFER_CAPACITY',
      bindingRule: 'TEMP_REEFER',
      choice: 'UNAVOIDABLE',
    });
  });

  it('allocate: with no vehicle at all the broken-down one is the reason', () => {
    const input = scenario({
      vehicles: [
        { id: 'fx-veh-1', available: false, unavailableReason: 'WORKSHOP' },
        { id: 'fx-veh-2', available: false, unavailableReason: 'BREAKDOWN' },
      ],
      orders: [{ id: 'fx-ord-1' }],
    });
    expect(allocate(input).unplanned[0]).toMatchObject({
      reasonCode: 'VEHICLE_BREAKDOWN',
      bindingRule: 'VEHICLE_AVAILABLE',
    });
  });

  it('allocate: orders already on a fixed trip are not planned again', () => {
    const base = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      orders: [{ id: 'fx-ord-1' }, { id: 'fx-ord-2' }],
    });
    const input = {
      ...base,
      fixedTrips: [
        {
          key: 'FV1#1',
          vehicleId: 'fx-veh-1',
          tripNo: 1,
          brand: 'FRESH' as const,
          districtId: 'fx-gampaha',
          orderIds: ['fx-ord-1'],
          minutes: 52,
          km: 44,
          litres: 8.8,
          weightKg: 10,
          volumeM3: 0.1,
        },
      ],
    };
    const output = allocate(input);
    expect(stopsByTrip(output.trips)).toEqual({ 'FV1#2': ['fx-ord-2'] });
    expect(validate(input, output).filter((v) => v.severity === 'HARD')).toEqual([]);
  });
});
