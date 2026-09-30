import type { AlertStatus } from '../domain';
import { defineMachine } from './machine';

export type AlertEvent = 'ACKNOWLEDGE' | 'RESOLVE' | 'AUTO_RESOLVE';

/**
 * Raising an alert again for the same dedupe key updates the open row instead
 * of transitioning. AUTO_RESOLVE fires when the action it asked for happens.
 */
export const alertMachine = defineMachine<AlertStatus, AlertEvent>('alert', {
  OPEN: {
    ACKNOWLEDGE: 'ACKNOWLEDGED',
    RESOLVE: 'RESOLVED',
    AUTO_RESOLVE: 'RESOLVED',
  },
  ACKNOWLEDGED: { RESOLVE: 'RESOLVED', AUTO_RESOLVE: 'RESOLVED' },
  RESOLVED: {},
});
