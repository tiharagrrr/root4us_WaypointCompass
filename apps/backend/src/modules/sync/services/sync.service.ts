import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import {
  can,
  SYNC_MAX_EVENTS,
  syncBatchSchema,
  type Actor,
  type SyncDriverEvent,
  type SyncLoaderEvent,
  type SyncResult,
} from '@waypoint/shared';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  DomainError,
  ForbiddenError,
  PayloadTooLargeError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { syncBatches } from '../../../db/schema';
import { StopEventService, type FieldEvent } from '../../execution';
import { LoaderEventService, type LoaderEvent } from '../../loading';
import {
  inDeviceOrder,
  parseEvent,
  rawClientUuid,
  rawSeq,
  rejected,
  tally,
  type ParsedEvent,
} from '../domain/sync-batch';
import type { SyncBatchAppliedEvent } from '../events/sync.events';
import { SYNC_EVENTS, SYNC_LOGS } from '../sync.constants';

export interface SyncOutcome {
  batchId: string;
  results: SyncResult[];
  received: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
}

/**
 * `POST /sync`: a device's outbox replayed once, in the order it was tapped (specs/sync/spec.md).
 *
 * 1. the envelope is checked and a batch over the limit is 413 (AC-SYN-05);
 * 2. events apply in deviceSeq order, each in its own savepoint, so one bad event is one rejected
 *    result and the rest still land (AC-SYN-01, AC-SYN-03);
 * 3. driver events go to execution's `StopEventService.apply`, loader events to loading's
 *    `LoaderEventService.apply`: the same handlers as the online paths, with the same clientUuid
 *    idempotency, so a replay comes back `duplicate` and changes nothing (AC-SYN-02, AC-SYN-13);
 * 4. a 409 or 412 from an applier is a `conflict` (the server moved while the device was away),
 *    anything else the device could have got right is `rejected`;
 * 5. one sync_batches row, one `sync.batch_applied` event and one log line hold the counts.
 *
 * Conflict rows for 19c, KEEP_DEVICE and KEEP_SERVER, and the changes feed (AC-SYN-06 to 12) are
 * not here yet: a conflicting event is reported to the device and left unapplied.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly drivers: StopEventService,
    private readonly loaders: LoaderEventService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(SyncService.name);
  }

  @Transactional()
  async apply(body: unknown, actor: Actor): Promise<SyncOutcome> {
    const envelope = syncBatchSchema.safeParse(body);
    if (!envelope.success)
      throw new ValidationError(
        envelope.error.issues.map((issue) => ({
          field: issue.path.map(String).join('.') || 'body',
          code: issue.code,
          message: issue.message,
        })),
      );
    const { deviceId, events } = envelope.data;
    if (events.length > SYNC_MAX_EVENTS)
      throw new PayloadTooLargeError(
        `A batch holds at most ${SYNC_MAX_EVENTS} events; this one has ${events.length}`,
      );

    const mayRecord = can(actor, 'stop:record');
    const mayLoad = can(actor, 'load:check');
    if (!mayRecord && !mayLoad)
      throw new ForbiddenError('Only drivers and loaders sync an outbox.');

    const results: SyncResult[] = [];
    let n = 0;
    for (const raw of inDeviceOrder(events, rawSeq)) {
      n += 1;
      const parsed = parseEvent(raw);
      if (parsed.kind === 'invalid') {
        results.push(
          rejected(
            rawClientUuid(raw),
            'VALIDATION_FAILED',
            parsed.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          ),
        );
        continue;
      }
      if (parsed.kind === 'driver' ? !mayRecord : !mayLoad) {
        results.push(
          rejected(
            parsed.event.clientUuid,
            'FORBIDDEN',
            `A ${actor.role} cannot send ${parsed.event.type}`,
          ),
        );
        continue;
      }
      results.push(await this.applyOne(parsed, deviceId, actor, `sync_${n}`));
    }

    const counts = tally(results);
    const [batch] = await this.txHost.tx
      .insert(syncBatches)
      .values({ deviceId, userId: actor.id, ...counts })
      .returning({ id: syncBatches.id });
    const payload: SyncBatchAppliedEvent = {
      v: 1,
      batchId: batch.id,
      deviceId,
      ...counts,
    };
    await this.outbox.add(SYNC_EVENTS.batchApplied, payload, {
      aggregate: ['sync_batch', batch.id],
      depotId: actor.depotId ?? undefined,
      userIds: [actor.id],
    });
    this.log.info(
      { event: SYNC_LOGS.batchApplied, batchId: batch.id, ...counts },
      'sync batch applied',
    );
    return { batchId: batch.id, results, ...counts };
  }

  /** One event in its own savepoint: a refusal rolls back only what that event wrote. */
  private async applyOne(
    parsed: Exclude<ParsedEvent, { kind: 'invalid' }>,
    deviceId: string,
    actor: Actor,
    savepoint: string,
  ): Promise<SyncResult> {
    try {
      return await this.inSavepoint(savepoint, async () => {
        if (parsed.kind === 'loader')
          return this.loaders.apply(
            toLoaderEvent(parsed.event, deviceId),
            actor,
          );
        const applied = await this.drivers.apply(
          { ...toFieldEvent(parsed.event, deviceId), source: 'OFFLINE_SYNC' },
          actor,
        );
        return {
          clientUuid: parsed.event.clientUuid,
          status: applied.duplicate ? 'duplicate' : 'applied',
          id: applied.event.id,
        };
      });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const conflict = err.status === 409 || err.status === 412;
      this.log.info(
        {
          event: SYNC_LOGS.eventRefused,
          type: parsed.event.type,
          code: err.code,
          status: conflict ? 'conflict' : 'rejected',
        },
        'sync event refused',
      );
      return {
        clientUuid: parsed.event.clientUuid,
        status: conflict ? 'conflict' : 'rejected',
        code: err.code,
        message: messageOf(err),
      };
    }
  }

  /**
   * A savepoint inside the request's transaction. The appliers join that transaction
   * (`@Transactional()` propagates), so a failed statement in one event poisons nothing
   * outside its savepoint.
   */
  private async inSavepoint<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const tx = this.txHost.tx;
    await tx.execute(sql.raw(`SAVEPOINT ${name}`));
    try {
      const out = await fn();
      await tx.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
      return out;
    } catch (err) {
      await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`));
      throw err;
    }
  }
}

/** The refusal as the device shows it (D6, L2): the field errors, or the detail. */
function messageOf(err: DomainError): string | undefined {
  if (err instanceof ValidationError && err.errors.length)
    return err.errors.map((e) => e.message).join('; ');
  return err.detail ?? err.message;
}

/** A wire event as execution's applier takes it; `occurredAt` becomes a Date here only. */
function toFieldEvent(event: SyncDriverEvent, deviceId: string): FieldEvent {
  return {
    clientUuid: event.clientUuid,
    type: event.type,
    tripId: event.tripId,
    stopId: event.stopId ?? null,
    occurredAt: new Date(event.occurredAt),
    deviceSeq: event.deviceSeq ?? null,
    deviceId,
    baseVersion: event.baseVersion ?? null,
    lat: event.lat ?? null,
    lng: event.lng ?? null,
    outcome: event.outcome ?? null,
    receiverName: event.receiverName ?? null,
    note: event.note ?? null,
    reasonCode: event.reasonCode ?? null,
    lines: event.lines ?? null,
    attachmentUuids: event.attachmentUuids ?? null,
    reeferTempC: event.reeferTempC ?? null,
  };
}

/** A wire event as loading's applier takes it. */
function toLoaderEvent(event: SyncLoaderEvent, deviceId: string): LoaderEvent {
  return {
    clientUuid: event.clientUuid,
    type: event.type,
    loadLineId: event.loadLineId ?? null,
    loadFlagId: event.loadFlagId ?? null,
    occurredAt: new Date(event.occurredAt),
    deviceSeq: event.deviceSeq ?? null,
    deviceId,
    checkedByName: event.checkedByName ?? null,
    qtyLoaded: event.qtyLoaded ?? null,
    reason: event.reason ?? null,
    qtyAffected: event.qtyAffected ?? null,
    note: event.note ?? null,
    photoClientUuid: event.photoClientUuid ?? null,
  };
}
