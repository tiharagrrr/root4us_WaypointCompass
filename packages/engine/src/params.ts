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
  /** The priority score's weights (specs/engine/rules.md section 5), settings planning.priorityWeights. */
  priorityWeights: z.strictObject({
    deferredOnLastRun: z.number().min(0),
    consecutiveDeferrals: z.number().min(0),
    daysSinceLastServed: z.number().min(0),
    fresh: z.number().min(0),
    chilled: z.number().min(0),
    urgent: z.number().min(0),
    tightWindow: z.number().min(0),
  }),
  /** An effective window shorter than this scores the tight-window weight. */
  tightWindowMin: z.number().positive(),
  /** Moves the repair pass may evaluate. It stops there, never on a wall-clock limit. */
  improveIterations: z.number().int().positive(),
  /**
   * An ambient order needs at least this priority before it may take a reefer that chilled orders
   * could still want (specs/engine/rules.md, TEMP_REEFER case (a)). 40 is a repeat skip's weight.
   */
  reeferAmbientMinPriority: z.number().min(0),
  /** A resource used past this percentage, and that caused a deferral, is a limiting resource. */
  limitingUtilisationPct: z.number().min(0).max(100),
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
  priorityWeights: {
    deferredOnLastRun: 40,
    consecutiveDeferrals: 10,
    daysSinceLastServed: 2,
    fresh: 15,
    chilled: 10,
    urgent: 8,
    tightWindow: 6,
  },
  tightWindowMin: 120,
  improveIterations: 2000,
  reeferAmbientMinPriority: 40,
  limitingUtilisationPct: 90,
};

/** DEFAULT_PARAMS with the overrides applied, validated. Throws a ZodError on a bad value. */
export function resolveParams(overrides: Partial<EngineParams> = {}): EngineParams {
  return engineParamsSchema.parse({ ...DEFAULT_PARAMS, ...overrides });
}
