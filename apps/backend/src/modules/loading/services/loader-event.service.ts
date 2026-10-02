import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../../core/errors/domain-errors';
import { fieldError } from '../domain/errors';
import {
  type BatchResult,
  inDeviceOrder,
  type LoaderEvent,
} from '../domain/loader-event';
import { LoadCheckService } from './load-check.service';
import { LoadFlagService } from './load-flag.service';
import { LoadingQueries } from './loading.queries';

/**
 * The one way a queued loader action is replayed, whichever way it arrives
 * (specs/loading/spec.md, "index.ts exports what sync needs to apply loader
 * events").
 *
 * `POST /sync` (ROO-44, sync's own module) hands over the loader events of a
 * batch and this applies them; the online endpoints call the same two
 * services directly. Both paths go through the same checks, the same audit
 * rows and the same `clientUuid` idempotency, so a check made with the wifi
 * off is indistinguishable from one made with it on except for the audit
 * row's `source` and `occurredAt` (AC-LOD-18).
 *
 * Events apply in `deviceSeq` order, not arrival order: a loader who flagged
 * a crate and then found it must not have the undo applied before the flag,
 * which would leave a flag open that they have already dealt with.
 *
 * Each event stands alone. A refused one comes back as `rejected` or
 * `conflict` with a code, and the ones around it still apply — a batch never
 * fails as a whole over one bad item.
 */
@Injectable()
export class LoaderEventService {
  constructor(
    private readonly checks: LoadCheckService,
    private readonly flags: LoadFlagService,
    private readonly queries: LoadingQueries,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(LoaderEventService.name);
  }

  /** A batch of queued loader actions, in the order the loader made them. */
  async applyMany(
    events: readonly LoaderEvent[],
    actor: Actor,
  ): Promise<BatchResult[]> {
    const results: BatchResult[] = [];
    for (const event of inDeviceOrder(events))
      results.push(await this.apply(event, actor));
    return results;
  }

  /**
   * One queued action. Its own transaction, so one refusal rolls back only
   * itself; `POST /sync` wraps each item in a savepoint for the same reason
   * (specs/sync/spec.md).
   */
  @Transactional()
  async apply(event: LoaderEvent, actor: Actor): Promise<BatchResult> {
    try {
      switch (event.type) {
        case 'LOAD_LINE_CHECKED':
          return await this.applyCheck(event, actor);
        case 'LOAD_CHECK_UNDONE':
          return await this.applyUndo(event, actor);
        case 'LOAD_FLAG_RAISED':
          return await this.applyFlag(event, actor);
        case 'LOAD_FLAG_UNDONE':
          return await this.applyFlagUndo(event, actor);
        case 'LOAD_RECHECKED':
          return await this.applyRecheck(event, actor);
      }
    } catch (err) {
      return this.refusal(event, err);
    }
  }

  private async applyCheck(
    event: LoaderEvent,
    actor: Actor,
  ): Promise<BatchResult> {
    const lineId = this.need(event.loadLineId, 'loadLineId');
    const line = await this.queries.line(lineId, actor);
    const [result] = (
      await this.checks.checkMany(
        line.tripId,
        [
          {
            lineId,
            qtyLoaded: this.need(event.qtyLoaded, 'qtyLoaded'),
            checkedByName: this.need(event.checkedByName, 'checkedByName'),
            clientUuid: event.clientUuid,
            checkedAt: event.occurredAt,
            deviceSeq: event.deviceSeq ?? null,
            deviceId: event.deviceId ?? null,
            source: 'OFFLINE_SYNC',
          },
        ],
        actor,
      )
    ).results;
    return result;
  }

  private async applyUndo(
    event: LoaderEvent,
    actor: Actor,
  ): Promise<BatchResult> {
    const lineId = this.need(event.loadLineId, 'loadLineId');
    const line = await this.checks.undo(lineId, actor, {
      checkedByName: event.checkedByName ?? null,
      at: event.occurredAt,
      source: 'OFFLINE_SYNC',
    });
    return { clientUuid: event.clientUuid, status: 'applied', id: line.id };
  }

  private async applyFlag(
    event: LoaderEvent,
    actor: Actor,
  ): Promise<BatchResult> {
    const { flag, duplicate } = await this.flags.raise(
      {
        loadLineId: this.need(event.loadLineId, 'loadLineId'),
        reason: this.need(event.reason, 'reason'),
        qtyAffected: this.need(event.qtyAffected, 'qtyAffected'),
        note: event.note ?? null,
        raisedByName: this.need(event.checkedByName, 'raisedByName'),
        clientUuid: event.clientUuid,
        at: event.occurredAt,
        source: 'OFFLINE_SYNC',
      },
      actor,
    );
    return {
      clientUuid: event.clientUuid,
      status: duplicate ? 'duplicate' : 'applied',
      id: flag.id,
    };
  }

  private async applyFlagUndo(
    event: LoaderEvent,
    actor: Actor,
  ): Promise<BatchResult> {
    const flagId = this.need(event.loadFlagId, 'loadFlagId');
    const before = await this.queries.flag(flagId, actor);
    // An undo whose flag is already resolved is this undo replayed, not a
    // refusal: the first copy of the event landed and the tablet re-sent it.
    if (before.status === 'RESOLVED' && before.decision == null)
      return { clientUuid: event.clientUuid, status: 'duplicate', id: flagId };
    const flag = await this.flags.undo(flagId, actor, {
      at: event.occurredAt,
      source: 'OFFLINE_SYNC',
    });
    return { clientUuid: event.clientUuid, status: 'applied', id: flag.id };
  }

  private async applyRecheck(
    event: LoaderEvent,
    actor: Actor,
  ): Promise<BatchResult> {
    const flagId = this.need(event.loadFlagId, 'loadFlagId');
    const before = await this.queries.flag(flagId, actor);
    const flag = await this.flags.recheck(
      flagId,
      {
        qtyLoaded: this.need(event.qtyLoaded, 'qtyLoaded'),
        checkedByName: this.need(event.checkedByName, 'checkedByName'),
        clientUuid: event.clientUuid,
        at: event.occurredAt,
        source: 'OFFLINE_SYNC',
      },
      actor,
    );
    return {
      clientUuid: event.clientUuid,
      status: before.status === 'RESOLVED' ? 'duplicate' : 'applied',
      id: flag.id,
    };
  }

  /**
   * A refusal as a per-item result. A 409 is a `conflict` — the server's
   * state moved while the tablet was away, which is 19c's business — and
   * anything else the loader could have got right is `rejected`.
   */
  private refusal(event: LoaderEvent, err: unknown): BatchResult {
    if (err instanceof DomainError) {
      const conflict = err.status === 409 || err.status === 412;
      this.log.info(
        {
          event: 'loading.sync.refused',
          clientUuid: event.clientUuid,
          type: event.type,
          code: err.code,
        },
        'loader event refused',
      );
      return {
        clientUuid: event.clientUuid,
        status: conflict ? 'conflict' : 'rejected',
        code: err.code,
        message: err.detail,
      };
    }
    throw err;
  }

  /** A field the event's type needs; a missing one is the tablet's bug. */
  private need<T>(value: T | null | undefined, field: string): T {
    if (value == null)
      throw fieldError(field, 'required', `${field} is required`);
    return value;
  }
}
