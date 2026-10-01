import type { RuleCode, RuleScope, Severity } from './codes';

/** Severity and scope of every rule (specs/engine/rules.md section 3). */
export const RULE_META: Readonly<Record<RuleCode, { severity: Severity; scope: RuleScope }>> = {
  CAP_WEIGHT: { severity: 'HARD', scope: 'trip' },
  CAP_VOLUME: { severity: 'HARD', scope: 'trip' },
  TEMP_REEFER: { severity: 'HARD', scope: 'trip' },
  ACCESS_VAN_ONLY: { severity: 'HARD', scope: 'trip' },
  DEPOT_HOME: { severity: 'HARD', scope: 'trip' },
  TRIP_BRAND_DISTRICT: { severity: 'HARD', scope: 'trip' },
  WHOLE_ORDER: { severity: 'HARD', scope: 'plan' },
  TRIP_LIMIT: { severity: 'HARD', scope: 'vehicle' },
  BUDGET_FRESH: { severity: 'HARD', scope: 'vehicle' },
  BUDGET_STYLE_TECH: { severity: 'HARD', scope: 'vehicle' },
  WINDOW_OUTLET: { severity: 'HARD', scope: 'trip' },
  WINDOW_MALL: { severity: 'HARD', scope: 'trip' },
  FUEL_WEEKLY: { severity: 'HARD', scope: 'vehicle' },
  VEHICLE_AVAILABLE: { severity: 'HARD', scope: 'vehicle' },
  OPERATING_DAY: { severity: 'HARD', scope: 'plan' },
  REPEAT_SKIP: { severity: 'SOFT', scope: 'order' },
  TECH_VALUE_LIMIT: { severity: 'SOFT', scope: 'trip' },
  LATE_RISK: { severity: 'SOFT', scope: 'trip' },
};
