import type { LoadFlagStatus } from '../domain';
import { defineMachine } from './machine';

export type LoadFlagEvent = 'REPLACE' | 'REMOVE' | 'UNDO' | 'RECHECK';

/**
 * The loader raises a flag (L3); the dispatcher decides (L3b). REPLACE sends the
 * loader back to re-pick and re-check (L3c); REMOVE resolves it with a partial
 * deferral; the raiser may UNDO before the dispatcher decides.
 */
export const loadFlagMachine = defineMachine<LoadFlagStatus, LoadFlagEvent>(
  'loadFlag',
  {
    OPEN: { REPLACE: 'AWAITING_RECHECK', REMOVE: 'RESOLVED', UNDO: 'RESOLVED' },
    AWAITING_RECHECK: { RECHECK: 'RESOLVED' },
    RESOLVED: {},
  },
);
