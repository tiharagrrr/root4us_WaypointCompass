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
export const DEFERRAL_CHOICES = ['UNAVOIDABLE', 'PRIORITY_CHOICE'] as const;
export type DeferralChoice = (typeof DEFERRAL_CHOICES)[number];
