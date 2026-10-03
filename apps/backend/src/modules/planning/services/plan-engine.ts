import { Injectable } from '@nestjs/common';
import {
  applyEdits,
  EngineInputError,
  optionsForTrip,
  suggestFixes,
  validate,
  vehicleOptions,
  type EditOp,
  type EngineInput,
  type Plan,
  type TripTarget,
  type Violation,
} from '@waypoint/engine';
import { ValidationError } from '../../../core/errors/domain-errors';

/**
 * The engine functions the API calls, with one translation: an input the
 * engine refuses (an unknown order, trip or vehicle in an edit) is a 400
 * VALIDATION_FAILED naming the field, not a 500. Rule violations are results,
 * never errors. Planning never re-implements a rule (architecture rule 8).
 */
@Injectable()
export class PlanEngine {
  validate(input: EngineInput, plan: Plan): Violation[] {
    return guard(() => validate(input, plan));
  }

  applyEdits(input: EngineInput, plan: Plan, edits: readonly EditOp[]) {
    return guard(() => applyEdits(input, plan, edits));
  }

  vehicleOptions(input: EngineInput, plan: Plan) {
    return guard(() => vehicleOptions(input, plan));
  }

  optionsForTrip(input: EngineInput, plan: Plan, target: TripTarget) {
    return guard(() => optionsForTrip(input, plan, target));
  }

  suggestFixes(input: EngineInput, plan: Plan, violation: Violation) {
    return guard(() => suggestFixes(input, plan, violation));
  }
}

function guard<T>(work: () => T): T {
  try {
    return work();
  } catch (err) {
    if (err instanceof EngineInputError)
      throw new ValidationError([
        { field: err.field, code: err.code, message: err.message },
      ]);
    throw err;
  }
}
