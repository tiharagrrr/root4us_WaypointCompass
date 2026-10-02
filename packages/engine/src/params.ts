import { z } from 'zod';

export const engineParamsSchema = z.strictObject({
  /** Fresh trips: minutes per vehicle per day (03:30 to 08:00). */
  freshBudgetMin: z.number().positive(),
  /** Style and Tech trips combined: minutes per vehicle per day. */
  styleTechBudgetMin: z.number().positive(),
  /** Fresh trip 1 departs here, in minutes after midnight (03:30). */
  freshStartMin: z.number().min(0).lt(1440),
  /** Trip 2 departs this long after trip 1 returns. */
  reloadMin: z.number().min(0),
  /** Trips per vehicle per day, fixed and reserved trips included. */
  maxTripsPerVehicle: z.number().int().positive(),
  /** Check delivery windows and late risk. */
  enforceWindows: z.boolean(),
  /** Check the weekly fuel quota. */
  enforceFuel: z.boolean(),
  /** A reefer may carry ambient orders; the allocator still prefers chilled orders on reefers. */
  reeferCarriesAmbient: z.boolean(),
  /** A Tech trip worth more than this needs a note; null means no limit. */
  techValueLimitLkr: z.number().positive().nullable(),
  /** A stop with less window slack than this is flagged. */
  lateRiskSlackMin: z.number().min(0),
  /** An outlet deferred this many runs in a row, ending on the last run, is a repeat skip. */
  repeatSkipLookbackRuns: z.number().int().positive(),
});

export type EngineParams = z.infer<typeof engineParamsSchema>;

export const DEFAULT_PARAMS: EngineParams = {
  freshBudgetMin: 270,
  styleTechBudgetMin: 480,
  freshStartMin: 210,
  reloadMin: 30,
  maxTripsPerVehicle: 2,
  enforceWindows: true,
  enforceFuel: true,
  reeferCarriesAmbient: true,
  techValueLimitLkr: null,
  lateRiskSlackMin: 15,
  repeatSkipLookbackRuns: 1,
};

/** DEFAULT_PARAMS with the overrides applied, validated. Throws a ZodError on a bad value. */
export function resolveParams(overrides: Partial<EngineParams> = {}): EngineParams {
  return engineParamsSchema.parse({ ...DEFAULT_PARAMS, ...overrides });
}
