import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { desc, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { ClockService } from '../../../core/clock/clock.service';
import { RequestContext } from '../../../core/context/request-context';
import { ValidationError } from '../../../core/errors/domain-errors';
import type {
  AuditEntry,
  AuditRecorder,
} from '../../../core/persistence/ports';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { auditEvents, type auditSourceEnum } from '../../../db/schema';
import { chainHash, GENESIS_HASH } from '../domain/hash-chain';

export type AuditSource = (typeof auditSourceEnum.enumValues)[number];

export interface AuditInput extends AuditEntry {
  /** Where the change came from when CLS can't tell; WEB by default. */
  source?: AuditSource;
  /** A name typed on a shared dock tablet, instead of the actor's. */
  actorName?: string;
}

/**
 * Actions refused without a reasonCode (specs/audit/spec.md, Model). Matched
 * on the action without its module: identity.user.role_changed needs one
 * because user.role_changed is listed. ROO-23 completes the table.
 */
const REASON_REQUIRED = new Set(['user.role_changed', 'user.scope_changed']);

/**
 * Appends one row to the hash-chained audit trail inside the use case's
 * transaction. The advisory lock serialises writers, so each row's prevHash
 * is the hash of the row before it. ROO-23 adds the chain check, the feed and
 * the export on top.
 */
@Injectable()
export class AuditService implements AuditRecorder {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly context: RequestContext,
  ) {}

  async record(input: AuditInput): Promise<{ id: string; seq: number }> {
    if (!this.txHost.isTransactionActive())
      throw new Error('audit.record() must run inside a transaction');
    const unqualified = input.action.split('.').slice(1).join('.');
    if (REASON_REQUIRED.has(unqualified) && !input.reasonCode)
      throw new ValidationError([
        {
          field: 'reasonCode',
          code: 'required',
          message: 'A reason is required',
        },
      ]);

    const tx = this.txHost.tx;
    // 4747 is the audit chain's lock (specs/audit/spec.md); held to commit.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4747)`);
    const [last] = await tx
      .select({ hash: auditEvents.hash })
      .from(auditEvents)
      .orderBy(desc(auditEvents.seq))
      .limit(1);

    const actor = this.context.actor;
    const row = {
      id: uuidv7(),
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      actorName: input.actorName ?? actor?.name ?? null,
      deviceId: this.context.deviceId ?? actor?.deviceId ?? null,
      source: input.source ?? 'WEB',
      action: input.action,
      entityType: input.entity[0],
      entityId: input.entity[1],
      before: input.before ?? null,
      after: input.after ?? null,
      reasonCode: input.reasonCode ?? null,
      reasonNote: input.reasonNote ?? null,
      occurredAt: input.occurredAt ?? this.clock.now(),
      recordedAt: this.clock.realNow(),
      correlationId: this.context.correlationId ?? null,
      clientUuid: input.clientUuid ?? null,
      prevHash: last?.hash ?? GENESIS_HASH,
    } satisfies Omit<typeof auditEvents.$inferInsert, 'seq' | 'hash'>;

    const [saved] = await tx
      .insert(auditEvents)
      .values({ ...row, hash: chainHash(row.prevHash, row) })
      .returning({ id: auditEvents.id, seq: auditEvents.seq });
    return saved;
  }
}
