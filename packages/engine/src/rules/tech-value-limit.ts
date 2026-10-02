import { lte, round } from '../util/lte';
import { defineRule, violation } from './types';

export const TECH_VALUE_LIMIT = defineRule('TECH_VALUE_LIMIT', {
  enabled: (p) => p.techValueLimitLkr !== null,
  check: ({ trip, orderById, params }) => {
    const limit = params.techValueLimitLkr;
    if (!trip || trip.brand !== 'TECH' || limit === null) return [];
    let value = 0;
    for (const id of trip.orderIds) value += orderById.get(id)?.valueLkr ?? 0;
    if (lte(value, limit)) return [];
    return [
      violation('TECH_VALUE_LIMIT', {
        tripKey: trip.key,
        actual: round(value),
        limit,
        message: `Tech trip ${trip.key} carries LKR ${round(value)}, over the LKR ${limit} limit; add a note`,
      }),
    ];
  },
});
