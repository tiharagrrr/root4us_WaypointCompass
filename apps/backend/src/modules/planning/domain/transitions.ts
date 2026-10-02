import {
  assertTransition,
  type StopEvent,
  stopMachine,
  type StopStatus,
  TransitionError,
  type TripEvent,
  tripMachine,
  type TripStatus,
} from '@waypoint/shared';
import { StateConflictError } from '../../../core/errors/domain-errors';

/**
 * The next trip or stop status, or 409 CONFLICT_STATE.
 *
 * `assertTransition` throws the shared `TransitionError`, which the problem
 * filter already renders as 409. Planning turns it into `StateConflictError`
 * first, so loading and execution can catch the one error class the module
 * documents rather than reaching for a transport detail (AC-PLN-34).
 */
export function nextTripStatus(from: TripStatus, event: TripEvent): TripStatus {
  return next(() => assertTransition(tripMachine, from, event));
}

export function nextStopStatus(from: StopStatus, event: StopEvent): StopStatus {
  return next(() => assertTransition(stopMachine, from, event));
}

function next<T>(move: () => T): T {
  try {
    return move();
  } catch (err) {
    if (err instanceof TransitionError)
      throw new StateConflictError(err.message);
    throw err;
  }
}
