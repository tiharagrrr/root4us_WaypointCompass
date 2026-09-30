import type { PlanStatus } from '../domain';
import { defineMachine } from './machine';

export type PlanEvent = 'PUBLISH' | 'REVISE' | 'CLOSE';

/** Publishing opens only after the previous operating day's cutoff; REVISE raises `revision`. */
export const planMachine = defineMachine<PlanStatus, PlanEvent>('plan', {
  DRAFT: { PUBLISH: 'PUBLISHED' },
  PUBLISHED: { REVISE: 'PUBLISHED', CLOSE: 'CLOSED' },
  CLOSED: {},
});
