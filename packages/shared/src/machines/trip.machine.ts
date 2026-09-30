import type { TripStatus } from '../domain';
import { defineMachine } from './machine';

export type TripEvent =
  | 'FILL'
  | 'START_LOADING'
  | 'RELEASE'
  | 'START'
  | 'COMPLETE'
  | 'REASSIGN'
  | 'REASSIGN_VEHICLE'
  | 'CANCEL';

/**
 * REASSIGN keeps the trip and changes its driver or vehicle. A released trip
 * moved to another vehicle goes back to LOADING (REASSIGN_VEHICLE). A trip can
 * be cancelled only before it starts, which clears tripNo and frees the slot.
 */
export const tripMachine = defineMachine<TripStatus, TripEvent>('trip', {
  RESERVED: { FILL: 'PLANNED', REASSIGN: 'RESERVED', CANCEL: 'CANCELLED' },
  PLANNED: {
    START_LOADING: 'LOADING',
    REASSIGN: 'PLANNED',
    CANCEL: 'CANCELLED',
  },
  LOADING: { RELEASE: 'RELEASED', REASSIGN: 'LOADING', CANCEL: 'CANCELLED' },
  RELEASED: {
    START: 'IN_PROGRESS',
    REASSIGN: 'RELEASED',
    REASSIGN_VEHICLE: 'LOADING',
    CANCEL: 'CANCELLED',
  },
  IN_PROGRESS: { COMPLETE: 'COMPLETED' },
  COMPLETED: {},
  CANCELLED: {},
});
