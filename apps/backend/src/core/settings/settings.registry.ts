import { z } from 'zod';

const minuteOfDay = z.number().int().min(0).max(1439);

/** demo.clock: how the demo clock runs (ClockService), set through PUT /clock. */
export const clockModeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('real') }),
  z.object({ mode: z.literal('offset'), offsetMs: z.number().int() }),
  z.object({ mode: z.literal('frozen'), at: z.iso.datetime({ offset: true }) }),
  z.object({
    mode: z.literal('simulated'),
    runId: z.string().min(1),
    at: z.iso.datetime({ offset: true }),
  }),
]);

export interface SettingDefinition<T = unknown> {
  schema: z.ZodType<T>;
  default: T;
  description: string;
  /** A depot may override the global value (settings row scoped to the depot id). */
  perDepot?: boolean;
  /** Who changes it when not PUT /settings: the clock endpoint or code. */
  managedBy?: 'clock' | 'code';
}

const define = <T>(d: SettingDefinition<T>) => d;

/**
 * Every setting, with its zod schema and default (specs/identity/spec.md,
 * Model). SettingsService resolves a depot override, then the global row,
 * then this default. Add a key here before any code reads it.
 */
export const SETTINGS = {
  'ordering.cutoffMin': define({
    schema: minuteOfDay,
    default: 960,
    perDepot: true,
    description: 'Order cutoff for the next day, minutes after midnight',
  }),
  'ordering.cutoffReminderMin': define({
    schema: minuteOfDay,
    default: 930,
    description: 'When outlets with no order get a reminder',
  }),
  'planning.reeferCarriesAmbient': define({
    schema: z.boolean(),
    default: true,
    description: 'A reefer may also carry ambient orders',
  }),
  'planning.enforceWindows': define({
    schema: z.boolean(),
    default: true,
    managedBy: 'code',
    description:
      'Planning rules check delivery windows (off for the Task 2B export)',
  }),
  'planning.freshStartMin': define({
    schema: minuteOfDay,
    default: 210,
    description: 'Earliest Fresh departure, minutes after midnight',
  }),
  'planning.reloadMinutes': define({
    schema: z.number().int().min(0).max(240),
    default: 30,
    description: "Gap between a vehicle's two trips",
  }),
  'planning.repeatSkipLookbackRuns': define({
    schema: z.number().int().min(1).max(10),
    default: 1,
    description: 'Runs back that count for a repeat skip',
  }),
  'planning.techValueLimitLkr': define({
    // Off until an admin sets it (specs/planning/spec.md); 0 also means off.
    schema: z.number().int().min(0).nullable(),
    default: null,
    description:
      'Most Tech stock value one trip may carry, LKR; empty for no limit',
  }),
  'planning.priorityWeights': define({
    schema: z.object({
      deferredOnLastRun: z.number().min(0),
      consecutiveDeferrals: z.number().min(0),
      daysSinceLastServed: z.number().min(0),
      fresh: z.number().min(0),
      chilled: z.number().min(0),
      urgent: z.number().min(0),
      tightWindow: z.number().min(0),
    }),
    default: {
      deferredOnLastRun: 40,
      consecutiveDeferrals: 10,
      daysSinceLastServed: 2,
      fresh: 15,
      chilled: 10,
      urgent: 8,
      tightWindow: 6,
    },
    managedBy: 'code',
    description: "The engine's order priority weights (specs/engine/rules.md)",
  }),
  'loading.maxReleaseTempC': define({
    schema: z.number().min(-30).max(15),
    default: 5.0,
    description: 'Warmest reefer temperature a chilled trip may leave at, °C',
  }),
  'tracking.offlineAlertMinutes': define({
    schema: z.number().int().min(1).max(240),
    default: 30,
    description: 'Minutes without a position before a vehicle-offline alert',
  }),
  'tracking.etaSlipNotifyMinutes': define({
    schema: z.number().int().min(1).max(240),
    default: 15,
    description: 'ETA slip that notifies the store',
  }),
  'tracking.lateRiskThreshold': define({
    schema: z.number().min(0).max(1),
    default: 0.5,
    description: 'Probability of lateness that raises LATE_RISK',
  }),
  'store.mustAcknowledgeDeferral': define({
    schema: z.boolean(),
    default: true,
    description: 'Stores must acknowledge a deferral notice',
  }),
  'demo.clock': define({
    schema: clockModeSchema,
    default: { mode: 'real' as const },
    managedBy: 'clock',
    description: 'How the demo clock runs (demo mode only)',
  }),
};

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> =
  (typeof SETTINGS)[K]['default'];

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const isSettingKey = (key: string): key is SettingKey =>
  Object.hasOwn(SETTINGS, key);
