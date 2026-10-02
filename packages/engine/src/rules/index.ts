import { ACCESS_VAN_ONLY } from './access-van-only';
import { BUDGET_FRESH } from './budget-fresh';
import { BUDGET_STYLE_TECH } from './budget-style-tech';
import { CAP_VOLUME } from './cap-volume';
import { CAP_WEIGHT } from './cap-weight';
import type { RuleCode } from './codes';
import { DEPOT_HOME } from './depot-home';
import { FUEL_WEEKLY } from './fuel-weekly';
import { LATE_RISK } from './late-risk';
import { OPERATING_DAY } from './operating-day';
import { REPEAT_SKIP } from './repeat-skip';
import { TECH_VALUE_LIMIT } from './tech-value-limit';
import { TEMP_REEFER } from './temp-reefer';
import { TRIP_BRAND_DISTRICT } from './trip-brand-district';
import { TRIP_LIMIT } from './trip-limit';
import type { Rule } from './types';
import { VEHICLE_AVAILABLE } from './vehicle-available';
import { WHOLE_ORDER } from './whole-order';
import { WINDOW_MALL } from './window-mall';
import { WINDOW_OUTLET } from './window-outlet';

/** In RULE_CODES order, which is the order violations are reported in. */
export const RULES: readonly Rule[] = [
  CAP_WEIGHT,
  CAP_VOLUME,
  TEMP_REEFER,
  ACCESS_VAN_ONLY,
  DEPOT_HOME,
  TRIP_BRAND_DISTRICT,
  WHOLE_ORDER,
  TRIP_LIMIT,
  BUDGET_FRESH,
  BUDGET_STYLE_TECH,
  WINDOW_OUTLET,
  WINDOW_MALL,
  FUEL_WEEKLY,
  VEHICLE_AVAILABLE,
  OPERATING_DAY,
  REPEAT_SKIP,
  TECH_VALUE_LIMIT,
  LATE_RISK,
];

export const RULE_BY_CODE: Readonly<Record<RuleCode, Rule>> = Object.fromEntries(
  RULES.map((r) => [r.code, r]),
) as Record<RuleCode, Rule>;
