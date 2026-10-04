import {
  type CalendarDay,
  type Fleet,
  forecastWeek,
  weeksAhead,
} from '../weekly-forecast';

const fleet: Fleet = {
  vehicles: 3,
  reefers: 1,
  drivers: 3,
  volumeCapM3: 50, // 20 + 20 + a 10 m³ reefer
  reeferVolumeCapM3: 10,
};
const noCalendar = new Map<string, CalendarDay>();

describe('weeksAhead', () => {
  it('starts at the Monday after today, whatever the weekday', () => {
    expect(weeksAhead('2026-10-01', 2).map((w) => w.weekStart)).toEqual([
      '2026-10-05',
      '2026-10-12',
    ]);
    expect(weeksAhead('2026-10-05', 1)[0]).toMatchObject({
      weekStart: '2026-10-12',
      isoYear: 2026,
      isoWeek: 42,
    });
  });

  it('crosses the ISO year', () => {
    expect(weeksAhead('2026-12-24', 2)).toMatchObject([
      { isoYear: 2026, isoWeek: 53 },
      { isoYear: 2027, isoWeek: 1 },
    ]);
  });
});

describe('forecastWeek', () => {
  // 5 to 11 Oct: six operating days when the calendar has no rows.
  const [week] = weeksAhead('2026-10-01', 1);
  const row = (
    brand: 'FRESH' | 'STYLE' | 'TECH',
    totalVolumeM3: number,
    chilledVolumeM3: number,
    source: 'BASELINE' | 'DATATHON',
  ) => ({
    brand,
    isoYear: 2026,
    isoWeek: 41,
    totalVolumeM3,
    chilledVolumeM3,
    source,
  });

  it('prefers the imported row, then a stored baseline, then history', () => {
    const result = forecastWeek(week, {
      calendar: noCalendar,
      stored: [
        row('FRESH', 90, 40, 'BASELINE'),
        row('FRESH', 100, 45, 'DATATHON'),
        row('STYLE', 30, 0, 'BASELINE'),
      ],
      history: new Map([
        ['STYLE', { totalVolumeM3: 99, chilledVolumeM3: 0 }],
        ['TECH', { totalVolumeM3: 2, chilledVolumeM3: 0 }],
      ]),
      fleet,
    });

    expect(result.brands).toEqual([
      {
        brand: 'FRESH',
        totalVolumeM3: 100,
        chilledVolumeM3: 45,
        source: 'DATATHON',
      },
      {
        brand: 'STYLE',
        totalVolumeM3: 30,
        chilledVolumeM3: 0,
        source: 'BASELINE',
      },
      {
        brand: 'TECH',
        totalVolumeM3: 12,
        chilledVolumeM3: 0,
        source: 'BASELINE',
      },
    ]);
    expect(result).toMatchObject({
      operatingDays: 6,
      totalVolumeM3: 142,
      chilledVolumeM3: 45,
      ambientVolumeM3: 97,
    });
  });

  it('flags a week over total or chilled capacity and sizes the gap', () => {
    const over = forecastWeek(week, {
      calendar: noCalendar,
      stored: [row('FRESH', 700, 150, 'DATATHON')],
      history: new Map(),
      fleet,
    });
    // 50 m³ × 2 trips × 6 days = 600; the reefer alone 10 × 2 × 6 = 120.
    expect(over).toMatchObject({
      capacityM3: 600,
      chilledCapacityM3: 120,
      overCapacity: true,
      gapVolumeM3: 100,
      chilledGapVolumeM3: 30,
      extraReefers: 1, // one more reefer adds 120
      extraVehicles: 0, // which also covers the 100 in total
    });

    const fits = forecastWeek(week, {
      calendar: noCalendar,
      stored: [row('FRESH', 600, 120, 'DATATHON')],
      history: new Map(),
      fleet,
    });
    expect(fits).toMatchObject({
      overCapacity: false,
      gapVolumeM3: 0,
      extraReefers: 0,
      extraVehicles: 0,
    });
  });

  it('lifts the baseline by the festival ramp and counts only operating days', () => {
    const calendar = new Map<string, CalendarDay>(
      week.days.map((date, i) => [
        date,
        {
          date,
          isOperating: i < 5,
          isPayday: i === 4,
          festival: i === 4 ? 'Deepavali' : null,
          festivalRamp: i === 4 ? 1 : 0,
          monsoon: false,
        },
      ]),
    );
    const result = forecastWeek(week, {
      calendar,
      stored: [],
      history: new Map([['FRESH', { totalVolumeM3: 10, chilledVolumeM3: 4 }]]),
      fleet,
      brand: 'FRESH',
    });
    // Four ordinary days and one at full ramp: 4 + 1.25 = 5.25 days of history.
    expect(result).toMatchObject({
      operatingDays: 5,
      totalVolumeM3: 52.5,
      chilledVolumeM3: 21,
      payday: true,
      festivals: ['Deepavali'],
      monsoon: false,
    });
  });

  it('has no brands when nothing is forecast and no history exists', () => {
    const result = forecastWeek(week, {
      calendar: noCalendar,
      stored: [],
      history: new Map(),
      fleet,
    });
    expect(result.brands).toEqual([]);
    expect(result.overCapacity).toBe(false);
  });
});
