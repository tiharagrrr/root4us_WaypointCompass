import { budgetUse } from '../time/budget';
import { lte, round } from '../util/lte';
import { defineRule, violation } from './types';

export const BUDGET_FRESH = defineRule('BUDGET_FRESH', {
  check: ({ vehicle, vehicleTrips, params }) => {
    if (!vehicle || !vehicleTrips) return [];
    const used = budgetUse(vehicleTrips).freshMinutes;
    if (lte(used, params.freshBudgetMin)) return [];
    return [
      violation('BUDGET_FRESH', {
        vehicleId: vehicle.id,
        actual: round(used),
        limit: params.freshBudgetMin,
        message: `${vehicle.code} uses ${round(used)} of ${params.freshBudgetMin} Fresh minutes`,
      }),
    ];
  },
});
