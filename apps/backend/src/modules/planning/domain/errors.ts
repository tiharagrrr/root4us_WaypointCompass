import {
  PlanLockedError,
  StateConflictError,
} from '../../../core/errors/domain-errors';

/** One reason a plan cannot be published yet (17); the shape publish-preview lists. */
export interface PublishBlocker {
  kind: 'HARD_VIOLATION' | 'NO_DRIVER' | 'UNDECIDED_ORDER' | 'NOT_DRAFT';
  message: string;
  orderId?: string;
  orderNo?: string;
  tripId?: string;
  tripKey?: string;
  rule?: string;
}

/** 409 PLAN_LOCKED before the previous operating day's cutoff (AC-PLN-03). */
export class PublishNotOpenError extends PlanLockedError {
  constructor(readonly opensAt: Date) {
    super(`Publishing opens at ${opensAt.toISOString()}.`);
  }

  extensions() {
    return { opensAt: this.opensAt.toISOString() };
  }
}

/**
 * 409 CONFLICT_STATE naming what still blocks publishing (AC-PLN-04, 20).
 * The web shows the same list from publish-preview before anyone presses
 * Publish; this answers only a publish that raced a new blocker.
 */
export class PublishBlockedError extends StateConflictError {
  constructor(readonly blockers: PublishBlocker[]) {
    super(
      `The plan cannot be published yet: ${blockers.map((b) => b.message).join('; ')}.`,
    );
  }

  extensions() {
    return { blockers: this.blockers };
  }
}
