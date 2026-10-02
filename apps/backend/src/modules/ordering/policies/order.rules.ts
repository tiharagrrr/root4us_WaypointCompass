import { Injectable } from '@nestjs/common';
import { type Actor, can, orderMachine } from '@waypoint/shared';
import type { OrderView } from '../services/order.view';
import { OrderScope } from './order.scope';

/** Statuses a dispatcher may still mark urgent: the order is not on a vehicle yet. */
const URGENT_STATUSES = new Set([
  'SUBMITTED',
  'CONFIRMED',
  'DEFERRED',
  'PLANNED',
]);

/**
 * The four tests an action has to pass (specs/api-conventions.md, "the
 * affordance rule"): the state machine allows the move, the actor holds the
 * permission, the row is in their scope, and the time rules allow it now.
 *
 * `OrdersService` and `OrderLinks` call the same method, so a link never
 * promises what the server would refuse, and AC-ORD-01, 03, 15, 19 and 29
 * check each link present and absent.
 *
 * The time rules in one place:
 * - a draft is always editable: nothing has been sent, and submitting it
 *   after the cutoff simply moves it to the next run;
 * - a sent order locks at its delivery date's cutoff (`editableUntil`), for
 *   both edits and a store's cancel;
 * - a dispatcher's cancel has no clock of its own: the machine stops it once
 *   the order is PLANNED.
 */
@Injectable()
export class OrderRules {
  constructor(private readonly scope: OrderScope) {}

  /** Whether the order is still before its cutoff. */
  beforeCutoff(order: OrderView, now: Date): boolean {
    return now.getTime() < order.editableUntil.getTime();
  }

  canSubmit(order: OrderView, actor: Actor): boolean {
    return (
      orderMachine.can(order.status, 'SUBMIT') &&
      can(actor, 'order:submit') &&
      this.scope.covers(order, actor)
    );
  }

  /** Changing the note, the date or the lines of an order. */
  canEdit(order: OrderView, actor: Actor, now: Date): boolean {
    const movable =
      order.status === 'DRAFT' || orderMachine.can(order.status, 'EDIT');
    return (
      movable &&
      can(actor, 'order:update') &&
      this.scope.covers(order, actor) &&
      (order.status === 'DRAFT' || this.beforeCutoff(order, now))
    );
  }

  canCancel(order: OrderView, actor: Actor, now: Date): boolean {
    const timeAllows =
      actor.role === 'store_manager'
        ? order.status === 'DRAFT' || this.beforeCutoff(order, now)
        : true;
    return (
      orderMachine.can(order.status, 'CANCEL') &&
      can(actor, 'order:cancel') &&
      this.scope.covers(order, actor) &&
      timeAllows
    );
  }

  /** A draft is removed; anything sent is cancelled instead (AC-ORD-18). */
  canDelete(order: OrderView, actor: Actor): boolean {
    return (
      order.status === 'DRAFT' &&
      can(actor, 'order:update') &&
      this.scope.covers(order, actor)
    );
  }

  /**
   * M8 reorders an order that was actually placed; a draft is simply edited.
   * The new draft's date and lines are worked out by the service, which also
   * refuses when an order of that class already exists for the date.
   */
  canReorder(order: OrderView, actor: Actor): boolean {
    return (
      order.status !== 'DRAFT' &&
      can(actor, 'order:create') &&
      this.scope.covers(order, actor)
    );
  }

  canSaveAsTemplate(order: OrderView, actor: Actor): boolean {
    return (
      order.totals.lines > 0 &&
      can(actor, 'order:create') &&
      this.scope.covers(order, actor)
    );
  }

  canSetPriority(order: OrderView, actor: Actor): boolean {
    return (
      URGENT_STATUSES.has(order.status) &&
      can(actor, 'order:queue') &&
      this.scope.covers(order, actor)
    );
  }
}
