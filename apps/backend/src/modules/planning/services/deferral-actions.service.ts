import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  StateConflictError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { deferrals } from '../../../db/schema';
import { AuditService } from '../../audit';
import { nextDeferralStatus, nextStoreResponse } from '../domain/transitions';
import type {
  DeferralResponseDto,
  ReplyDeferralDto,
  ReverseDeferralDto,
} from '../dto/deferral.dto';
import { canReply, canRespond } from '../policies/deferral.links';
import { PLANNING_AUDIT, PLANNING_EVENTS } from '../planning.constants';
import { DeferralQueries, type DeferralView } from './deferral.queries';

/**
 * What happens to a deferral after the dispatcher has decided it: the store
 * answers on M4 (AC-PLN-27), a dispatcher reverses it on 19c when the
 * device's delivery is kept (AC-PLN-28), and a dispatcher replies to the store
 * from 23 (AC-PLN-35).
 *
 * Neither changes the order. Acknowledged, priority requested or never
 * answered, the order stays DEFERRED with its new delivery date, and the next
 * run's queue picks it up either way (the deferred order's flow).
 */
@Injectable()
export class DeferralActions {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly queries: DeferralQueries,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(DeferralActions.name);
  }

  /** M4: acknowledge, or ask for priority with a note, once. */
  @Transactional()
  async respond(
    id: string,
    dto: DeferralResponseDto,
    actor: Actor,
  ): Promise<DeferralView> {
    const note = dto.note?.trim() || null;
    const priority = dto.response === 'PRIORITY_REQUESTED';
    if (priority && !note)
      throw new ValidationError([
        {
          field: 'note',
          code: 'required',
          message: 'Say why this order needs priority',
        },
      ]);

    const before = await this.queries.get(id, actor);
    if (!canRespond(before, actor))
      throw new StateConflictError(
        'This deferral has been answered, or its order is no longer waiting',
      );
    const response = nextStoreResponse(
      'AWAITING',
      priority ? 'REQUEST_PRIORITY' : 'ACKNOWLEDGE',
    );

    // Conditional on AWAITING, so two answers at once cannot both land.
    const [row] = await this.txHost.tx
      .update(deferrals)
      .set({
        storeResponse: response,
        storeNote: note,
        storeRespondedById: actor.id,
        storeRespondedAt: this.clock.now(),
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(deferrals.id, id), eq(deferrals.storeResponse, 'AWAITING')))
      .returning({ id: deferrals.id });
    if (!row) throw new StateConflictError('This deferral has been answered');

    await this.audit.record({
      action: PLANNING_AUDIT.deferralStoreResponded,
      entity: ['deferral', id],
      before: { storeResponse: before.storeResponse },
      after: { storeResponse: response, storeNote: note },
    });
    await this.outbox.add(
      PLANNING_EVENTS.deferralStoreResponded,
      {
        v: 1,
        deferralId: id,
        orderId: before.orderId,
        outletId: before.outletId,
        priorityRequested: priority,
        ...(note && { note }),
        respondedById: actor.id,
      },
      { aggregate: ['deferral', id], depotId: before.depotId },
    );
    this.log.info(
      {
        event: PLANNING_AUDIT.deferralStoreResponded,
        deferralId: id,
        orderId: before.orderId,
        response,
      },
      'the store answered a deferral',
    );
    return this.queries.get(id, actor);
  }

  /** 19c: the device's delivery stands, so the deferral no longer does. */
  @Transactional()
  async reverse(
    id: string,
    dto: ReverseDeferralDto,
    actor: Actor,
  ): Promise<DeferralView> {
    const before = await this.queries.get(id, actor);
    const status = nextDeferralStatus(
      before.status as Parameters<typeof nextDeferralStatus>[0],
      'REVERSE',
    );
    const [row] = await this.txHost.tx
      .update(deferrals)
      .set({
        status,
        reversedAt: this.clock.now(),
        reversedReason: dto.reason,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(deferrals.id, id), eq(deferrals.status, 'CONFIRMED')))
      .returning({ id: deferrals.id });
    if (!row) throw new StateConflictError('This deferral has changed');

    await this.audit.record({
      action: PLANNING_AUDIT.deferralReversed,
      entity: ['deferral', id],
      before: { status: before.status },
      after: { status, reversedReason: dto.reason },
      reasonNote: dto.reason,
    });
    await this.outbox.add(
      PLANNING_EVENTS.deferralReversed,
      { v: 1, deferralId: id, orderId: before.orderId },
      { aggregate: ['deferral', id], depotId: before.depotId },
    );
    this.log.info(
      {
        event: PLANNING_AUDIT.deferralReversed,
        deferralId: id,
        orderId: before.orderId,
      },
      'a deferral was reversed',
    );
    return this.queries.get(id, actor);
  }

  /** 23: the dispatcher's one reply to the store, which M4 shows under the store's note. */
  @Transactional()
  async reply(
    id: string,
    dto: ReplyDeferralDto,
    actor: Actor,
  ): Promise<DeferralView> {
    const text = dto.text.trim();
    if (!text)
      throw new ValidationError([
        { field: 'text', code: 'required', message: 'Write the reply' },
      ]);
    const before = await this.queries.get(id, actor);
    if (!canReply(before, actor))
      throw new StateConflictError(
        'This deferral has a reply already, or the store has not been told about it',
      );

    // Conditional on no reply yet, so two replies at once cannot both land.
    const [row] = await this.txHost.tx
      .update(deferrals)
      .set({
        dispatcherReply: text,
        dispatcherRepliedById: actor.id,
        dispatcherRepliedAt: this.clock.now(),
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(deferrals.id, id), isNull(deferrals.dispatcherReply)))
      .returning({ id: deferrals.id });
    if (!row) throw new StateConflictError('This deferral has a reply already');

    await this.audit.record({
      action: PLANNING_AUDIT.deferralReplied,
      entity: ['deferral', id],
      before: { dispatcherReply: null },
      after: { dispatcherReply: text },
    });
    await this.outbox.add(
      PLANNING_EVENTS.deferralReplied,
      {
        v: 1,
        deferralId: id,
        orderId: before.orderId,
        outletId: before.outletId,
        repliedById: actor.id,
      },
      { aggregate: ['deferral', id], depotId: before.depotId },
    );
    this.log.info(
      {
        event: PLANNING_AUDIT.deferralReplied,
        deferralId: id,
        orderId: before.orderId,
      },
      'a dispatcher replied to the store',
    );
    return this.queries.get(id, actor);
  }
}
