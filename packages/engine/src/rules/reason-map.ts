import type { BindingRule } from './codes';

// The single source for deferral reasons. The deferral_reasons seed is generated from
// DEFERRAL_REASONS, never typed by hand (specs/engine/rules.md section 6).

export const ENGINE_REASON_CODES = [
  'NO_REEFER_CAPACITY',
  'VAN_SHORTAGE',
  'OVER_CAPACITY',
  'TIME_BUDGET',
  'WINDOW_CONFLICT',
  'FUEL_QUOTA',
  'VEHICLE_BREAKDOWN',
] as const;
export type EngineReasonCode = (typeof ENGINE_REASON_CODES)[number];

export const MANUAL_REASON_CODES = ['ACCESS_ISSUE', 'STORE_REQUEST', 'OTHER'] as const;
export type ManualReasonCode = (typeof MANUAL_REASON_CODES)[number];

export const DEFERRAL_REASON_CODES = [...ENGINE_REASON_CODES, ...MANUAL_REASON_CODES] as const;
export type DeferralReasonCode = (typeof DEFERRAL_REASON_CODES)[number];

export interface ReasonText {
  reasonCode: EngineReasonCode;
  /** What the dispatcher sees. */
  dispatcherLabel: string;
  /** What the store sees on M4. Never internal numbers. */
  storeText: string;
}

const TEXT: Record<EngineReasonCode, Omit<ReasonText, 'reasonCode'>> = {
  NO_REEFER_CAPACITY: {
    dispatcherLabel: 'No reefer capacity',
    storeText: 'All refrigerated trucks were full for this run.',
  },
  VAN_SHORTAGE: {
    dispatcherLabel: 'No van available',
    storeText: 'Your outlet needs a van, and every van was booked.',
  },
  OVER_CAPACITY: {
    dispatcherLabel: 'Fleet full',
    storeText: 'Every suitable vehicle was full for this run.',
  },
  TIME_BUDGET: {
    dispatcherLabel: 'No time left on the run',
    storeText: 'The delivery run had no time left to reach you.',
  },
  WINDOW_CONFLICT: {
    dispatcherLabel: "Window can't be met",
    storeText: "We couldn't reach you inside your delivery window.",
  },
  FUEL_QUOTA: {
    dispatcherLabel: 'Fuel quota reached',
    storeText: 'Our vehicles reached their weekly fuel limit.',
  },
  VEHICLE_BREAKDOWN: {
    dispatcherLabel: 'Vehicle broke down',
    storeText: 'The vehicle for your delivery broke down.',
  },
};

const BINDING_TO_REASON: Record<BindingRule, EngineReasonCode> = {
  TEMP_REEFER: 'NO_REEFER_CAPACITY',
  ACCESS_VAN_ONLY: 'VAN_SHORTAGE',
  CAP_WEIGHT: 'OVER_CAPACITY',
  CAP_VOLUME: 'OVER_CAPACITY',
  TRIP_LIMIT: 'OVER_CAPACITY',
  BUDGET_FRESH: 'TIME_BUDGET',
  BUDGET_STYLE_TECH: 'TIME_BUDGET',
  WINDOW_OUTLET: 'WINDOW_CONFLICT',
  WINDOW_MALL: 'WINDOW_CONFLICT',
  FUEL_WEEKLY: 'FUEL_QUOTA',
  // Overridden to VEHICLE_BREAKDOWN when the vehicle broke down; a workshop vehicle means the fleet is short.
  VEHICLE_AVAILABLE: 'OVER_CAPACITY',
};

/** DEPOT_HOME is never a reason (candidates are filtered first); the structural rules never bind. */
export function reasonCodeFor(
  rule: BindingRule,
  vehicle?: { unavailableReason?: 'WORKSHOP' | 'BREAKDOWN' | null },
): EngineReasonCode {
  if (rule === 'VEHICLE_AVAILABLE' && vehicle?.unavailableReason === 'BREAKDOWN') return 'VEHICLE_BREAKDOWN';
  return BINDING_TO_REASON[rule];
}

export function reasonFor(
  rule: BindingRule,
  vehicle?: { unavailableReason?: 'WORKSHOP' | 'BREAKDOWN' | null },
): ReasonText {
  const reasonCode = reasonCodeFor(rule, vehicle);
  return { reasonCode, ...TEXT[reasonCode] };
}

export interface DeferralReasonSeed {
  code: DeferralReasonCode;
  label: string;
  /** Null for a manual reason: the store sees the dispatcher's note. */
  storeText: string | null;
  fromEngine: boolean;
  sortOrder: number;
}

/** The rows of deferral_reasons: engine reasons first, then the ones a dispatcher picks by hand. */
export const DEFERRAL_REASONS: readonly DeferralReasonSeed[] = [
  ...ENGINE_REASON_CODES.map((code, i) => ({
    code,
    label: TEXT[code].dispatcherLabel,
    storeText: TEXT[code].storeText,
    fromEngine: true,
    sortOrder: i + 1,
  })),
  { code: 'ACCESS_ISSUE', label: 'Access issue', storeText: null, fromEngine: false, sortOrder: 8 },
  { code: 'STORE_REQUEST', label: 'Store request', storeText: null, fromEngine: false, sortOrder: 9 },
  { code: 'OTHER', label: 'Other', storeText: null, fromEngine: false, sortOrder: 10 },
];
