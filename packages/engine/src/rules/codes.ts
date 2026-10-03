// The single source for rule codes and deferral choices. The Postgres enums, the shared arrays and
// the deferral_reasons seed are generated from these, never typed by hand.

export const RULE_CODES = [
  'CAP_WEIGHT',
  'CAP_VOLUME',
  'TEMP_REEFER',
  'ACCESS_VAN_ONLY',
  'DEPOT_HOME',
  'TRIP_BRAND_DISTRICT',
  'WHOLE_ORDER',
  'TRIP_LIMIT',
  'BUDGET_FRESH',
  'BUDGET_STYLE_TECH',
  'WINDOW_OUTLET',
  'WINDOW_MALL',
  'FUEL_WEEKLY',
  'VEHICLE_AVAILABLE',
  'OPERATING_DAY',
  'REPEAT_SKIP',
  'TECH_VALUE_LIMIT',
  'LATE_RISK',
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

export const SEVERITIES = ['HARD', 'SOFT'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RULE_SCOPES = ['trip', 'vehicle', 'order', 'plan'] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

/** Rules that can be the last thing between an order and a vehicle (a deferral's bindingRule). */
export const BINDING_RULES = [
  'TEMP_REEFER',
  'ACCESS_VAN_ONLY',
  'CAP_WEIGHT',
  'CAP_VOLUME',
  'TRIP_LIMIT',
  'BUDGET_FRESH',
  'BUDGET_STYLE_TECH',
  'WINDOW_OUTLET',
  'WINDOW_MALL',
  'FUEL_WEEKLY',
  'VEHICLE_AVAILABLE',
] as const satisfies readonly RuleCode[];
export type BindingRule = (typeof BINDING_RULES)[number];

/** UNAVOIDABLE: no feasible place existed. PRIORITY_CHOICE: a higher-priority order took the space. */
export { DEFERRAL_CHOICES, type DeferralChoice } from '@waypoint/shared/domain';

/**
 * Why an order was left out of the plan altogether instead of deferred. Both mean something upstream
 * went wrong: the API queues only orders that are due on an operating day.
 */
export const EXCLUSION_CODES = ['NOT_DUE_TODAY', 'NOT_AN_OPERATING_DAY'] as const;
export type ExclusionCode = (typeof EXCLUSION_CODES)[number];

/** The resources a plan runs out of. explain() reports how much of each the plan used. */
export const SCARCE_RESOURCES = [
  'REEFER_VOLUME',
  'VAN_TRIPS',
  'FRESH_MINUTES',
  'STYLE_TECH_MINUTES',
  'FUEL',
] as const;
export type ScarceResource = (typeof SCARCE_RESOURCES)[number];
