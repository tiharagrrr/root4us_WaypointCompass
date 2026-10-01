import { budgetUse } from '../time/budget';
import { lte, round } from '../util/lte';
import { defineRule, violation } from './types';

export const BUDGET_STYLE_TECH = defineRule('BUDGET_STYLE_TECH', {
  check: ({ vehicle, vehicleTrips, params }) => {
    if (!vehicle || !vehicleTrips) return [];
    const used = budgetUse(vehicleTrips).styleTechMinutes;
    if (lte(used, params.styleTechBudgetMin)) return [];
    return [
      violation('BUDGET_STYLE_TECH', {
        vehicleId: vehicle.id,
        actual: round(used),
        limit: params.styleTechBudgetMin,
        message: `${vehicle.code} uses ${round(used)} of ${params.styleTechBudgetMin} Style and Tech minutes`,
      }),
    ];
  },
});
