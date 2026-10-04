import {
  addDays,
  dowOf,
  isDefaultOperatingDay,
  isoWeekOf,
  MAX_TRIPS_PER_VEHICLE_PER_DAY,
} from '@waypoint/shared';

export const BRANDS = ['FRESH', 'STYLE', 'TECH'] as const;
export type Brand = (typeof BRANDS)[number];
export type ForecastSource = 'BASELINE' | 'DATATHON';

/**
 * How much a festival lifts the baseline: a day at full ramp (the festival
 * itself) counts as 1.25 ordinary days. Provisional until the owner sets the
 * ramp's shape (specs/forecasting/spec.md, Open questions).
 */
export const FESTIVAL_UPLIFT = 0.25;

/** How many days of order history the baseline averages over. */
export const HISTORY_WINDOW_DAYS = 56;

/** What the calendar says about one business date. */
export interface CalendarDay {
  date: string;
  isOperating: boolean;
  isPayday: boolean;
  festival: string | null;
  festivalRamp: number;
  monsoon: boolean;
}

/** One ISO week: its Monday and its seven dates. */
export interface WeekWindow {
  isoYear: number;
  isoWeek: number;
  weekStart: string;
  days: string[];
}

/** A stored forecast row for one depot, brand and ISO week. */
export interface StoredForecast {
  brand: Brand;
  isoYear: number;
  isoWeek: number;
  totalVolumeM3: number;
  chilledVolumeM3: number;
  source: ForecastSource;
}

/** A brand's mean volume per operating day of history. */
export interface DailyMean {
  totalVolumeM3: number;
  chilledVolumeM3: number;
}

/** The depot's vehicles that can run today, and its drivers. */
export interface Fleet {
  vehicles: number;
  reefers: number;
  drivers: number;
  /** Summed load volume of the active vehicles, one trip each. */
  volumeCapM3: number;
  /** The same for the reefers alone: what can carry chilled. */
  reeferVolumeCapM3: number;
}

export interface BrandForecast {
  brand: Brand;
  totalVolumeM3: number;
  chilledVolumeM3: number;
  source: ForecastSource;
}

export interface WeekForecast extends Omit<WeekWindow, 'days'> {
  operatingDays: number;
  totalVolumeM3: number;
  chilledVolumeM3: number;
  ambientVolumeM3: number;
  capacityM3: number;
  chilledCapacityM3: number;
  overCapacity: boolean;
  /** Volume past the capacity; 0 when the week fits. */
  gapVolumeM3: number;
  chilledGapVolumeM3: number;
  /** More reefers and other vehicles needed to close the gap; null with no fleet to size them by. */
  extraReefers: number | null;
  extraVehicles: number | null;
  payday: boolean;
  festivals: string[];
  monsoon: boolean;
  brands: BrandForecast[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The `count` ISO weeks after the one holding `today`, in order. */
export function weeksAhead(today: string, count: number): WeekWindow[] {
  const nextMonday = addDays(today, 7 - dowOf(today));
  return Array.from({ length: count }, (_, i) => {
    const weekStart = addDays(nextMonday, i * 7);
    return {
      ...isoWeekOf(weekStart),
      weekStart,
      days: Array.from({ length: 7 }, (_, d) => addDays(weekStart, d)),
    };
  });
}

/** The calendar's row for a date, or Monday to Saturday with nothing marked (AC-MD-10). */
function dayOf(date: string, calendar: ReadonlyMap<string, CalendarDay>) {
  return (
    calendar.get(date) ?? {
      date,
      isOperating: isDefaultOperatingDay(date),
      isPayday: false,
      festival: null,
      festivalRamp: 0,
      monsoon: false,
    }
  );
}

/**
 * One week's forecast against the fleet. Each brand takes its imported
 * (DATATHON) row when there is one, then a stored BASELINE row, then the
 * baseline worked out here: the brand's mean volume per operating day of
 * history, over the week's operating days, each lifted by its festival ramp.
 *
 * Capacity is what the active fleet can move in the week: every vehicle's
 * load volume, for the trips a vehicle may run a day, on each operating day.
 * Chilled capacity is the same over the reefers. A week is over capacity when
 * its volume passes either.
 */
export function forecastWeek(
  week: WeekWindow,
  input: {
    calendar: ReadonlyMap<string, CalendarDay>;
    stored: readonly StoredForecast[];
    history: ReadonlyMap<Brand, DailyMean>;
    fleet: Fleet;
    brand?: Brand;
  },
): WeekForecast {
  const days = week.days.map((d) => dayOf(d, input.calendar));
  const operating = days.filter((d) => d.isOperating);
  const dayWeight = operating.reduce(
    (sum, d) => sum + 1 + FESTIVAL_UPLIFT * d.festivalRamp,
    0,
  );

  const brands: BrandForecast[] = [];
  for (const brand of input.brand ? [input.brand] : BRANDS) {
    const rows = input.stored.filter(
      (r) =>
        r.brand === brand &&
        r.isoYear === week.isoYear &&
        r.isoWeek === week.isoWeek,
    );
    const row =
      rows.find((r) => r.source === 'DATATHON') ??
      rows.find((r) => r.source === 'BASELINE');
    const mean = input.history.get(brand);
    if (row) {
      brands.push({
        brand,
        totalVolumeM3: round2(row.totalVolumeM3),
        chilledVolumeM3: round2(row.chilledVolumeM3),
        source: row.source,
      });
    } else if (mean) {
      brands.push({
        brand,
        totalVolumeM3: round2(mean.totalVolumeM3 * dayWeight),
        chilledVolumeM3: round2(mean.chilledVolumeM3 * dayWeight),
        source: 'BASELINE',
      });
    }
  }

  const totalVolumeM3 = round2(
    brands.reduce((sum, b) => sum + b.totalVolumeM3, 0),
  );
  const chilledVolumeM3 = round2(
    brands.reduce((sum, b) => sum + b.chilledVolumeM3, 0),
  );
  const runs = MAX_TRIPS_PER_VEHICLE_PER_DAY * operating.length;
  const capacityM3 = round2(input.fleet.volumeCapM3 * runs);
  const chilledCapacityM3 = round2(input.fleet.reeferVolumeCapM3 * runs);
  const gapVolumeM3 = round2(Math.max(0, totalVolumeM3 - capacityM3));
  const chilledGapVolumeM3 = round2(
    Math.max(0, chilledVolumeM3 - chilledCapacityM3),
  );

  // One more vehicle adds an average vehicle's volume for the week's runs; a
  // reefer hired for chilled also carries part of the total gap.
  const perVehicle = input.fleet.vehicles
    ? (input.fleet.volumeCapM3 / input.fleet.vehicles) * runs
    : 0;
  const perReefer = input.fleet.reefers
    ? (input.fleet.reeferVolumeCapM3 / input.fleet.reefers) * runs
    : perVehicle;
  const extraReefers =
    chilledGapVolumeM3 === 0
      ? 0
      : perReefer > 0
        ? Math.ceil(chilledGapVolumeM3 / perReefer)
        : null;
  const stillShort = Math.max(0, gapVolumeM3 - (extraReefers ?? 0) * perReefer);
  const extraVehicles =
    stillShort === 0
      ? 0
      : perVehicle > 0
        ? Math.ceil(stillShort / perVehicle)
        : null;

  return {
    isoYear: week.isoYear,
    isoWeek: week.isoWeek,
    weekStart: week.weekStart,
    operatingDays: operating.length,
    totalVolumeM3,
    chilledVolumeM3,
    ambientVolumeM3: round2(totalVolumeM3 - chilledVolumeM3),
    capacityM3,
    chilledCapacityM3,
    overCapacity: gapVolumeM3 > 0 || chilledGapVolumeM3 > 0,
    gapVolumeM3,
    chilledGapVolumeM3,
    extraReefers,
    extraVehicles,
    payday: days.some((d) => d.isPayday),
    festivals: [
      ...new Set(days.flatMap((d) => (d.festival ? [d.festival] : []))),
    ],
    monsoon: days.some((d) => d.monsoon),
    brands,
  };
}
