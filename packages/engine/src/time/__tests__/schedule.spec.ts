import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../../params';
import { nextTripDepartMin, scheduleTrip } from '../schedule';

const open = { windowOpenMin: 0, windowCloseMin: 1440 };
const gampaha = { depotToDistrictMin: 37, interStopMin: 9 };
const colombo = { depotToDistrictMin: 24, interStopMin: 8 };
const stops = (allowances: number[]) =>
  allowances.map((allowanceMin) => ({ allowanceMin, ...open }));

describe('scheduleTrip', () => {
  it('schedule: first arrival is departure plus the depot-to-district minutes', () => {
    const s = scheduleTrip({ departMin: 210, district: gampaha, stops: stops([15, 15, 16]) });
    expect(s.stops.map((x) => x.arriveMin)).toEqual([247, 271, 295]);
    expect(s.stops.map((x) => x.finishMin)).toEqual([262, 286, 311]);
    expect(s.returnMin).toBe(311 + 37);
  });

  it('schedule: a vehicle that arrives before the window opens waits', () => {
    const s = scheduleTrip({
      departMin: 210,
      district: gampaha,
      stops: [{ allowanceMin: 15, windowOpenMin: 300, windowCloseMin: 480 }],
    });
    expect(s.stops[0]).toEqual({
      arriveMin: 247,
      startMin: 300,
      waitMin: 53,
      finishMin: 315,
    });
  });

  it('schedule: a trip with no stops returns when it departs', () => {
    const s = scheduleTrip({ departMin: 210, district: gampaha, stops: [] });
    expect(s.stops).toEqual([]);
    expect(s.returnMin).toBe(210);
  });

  it('schedule: Gampaha then Colombo ends the last service at 08:10 (490)', () => {
    const t1 = scheduleTrip({
      departMin: DEFAULT_PARAMS.freshStartMin,
      district: gampaha,
      stops: stops([15, 15, 16]),
    });
    const depart2 = nextTripDepartMin(t1, DEFAULT_PARAMS);
    expect(depart2).toBe(311 + 37 + 30);
    const t2 = scheduleTrip({ departMin: depart2, district: colombo, stops: stops([16, 16, 16, 16]) });
    expect(t2.stops.at(-1)?.finishMin).toBe(490);
  });

  it('schedule: Colombo then Gampaha ends the last service at 07:57 (477)', () => {
    const t1 = scheduleTrip({
      departMin: DEFAULT_PARAMS.freshStartMin,
      district: colombo,
      stops: stops([16, 16, 16, 16]),
    });
    const depart2 = nextTripDepartMin(t1, DEFAULT_PARAMS);
    const t2 = scheduleTrip({ departMin: depart2, district: gampaha, stops: stops([15, 15, 16]) });
    expect(t2.stops.at(-1)?.finishMin).toBe(477);
  });
});
