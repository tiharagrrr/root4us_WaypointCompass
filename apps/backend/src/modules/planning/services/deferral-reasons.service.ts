import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { asc, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  NotFoundError,
  StateConflictError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { deferralReasons } from '../../../db/schema';
import { AuditService } from '../../audit';
import type {
  CreateDeferralReasonDto,
  UpdateDeferralReasonDto,
} from '../dto/deferral-reason.dto';

export type DeferralReasonRow = typeof deferralReasons.$inferSelect;

/** deferral_reason.created and deferral_reason.updated: clients refetch the list. */
export type DeferralReasonEvent = { v: 1; code: string };

/**
 * The reasons a deferral can carry (A6). Reference data every role that
 * reads deferrals sees in full; the engine's own reasons stay active.
 */
@Injectable()
export class DeferralReasonsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(DeferralReasonsService.name);
  }

  list(): Promise<DeferralReasonRow[]> {
    return this.txHost.tx
      .select()
      .from(deferralReasons)
      .orderBy(asc(deferralReasons.sortOrder), asc(deferralReasons.code));
  }

  async get(code: string): Promise<DeferralReasonRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(deferralReasons)
      .where(eq(deferralReasons.code, code));
    if (!row) throw new NotFoundError('deferral reason');
    return row;
  }

  /** A hand-given reason (fromEngine false); 409 when the code exists. */
  @Transactional()
  async create(dto: CreateDeferralReasonDto): Promise<DeferralReasonRow> {
    const [row] = await this.txHost.tx
      .insert(deferralReasons)
      .values({
        code: dto.code,
        label: dto.label,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder ?? 100,
        fromEngine: false,
        active: true,
      })
      .onConflictDoNothing()
      .returning();
    if (!row)
      throw new StateConflictError(`A reason with code ${dto.code} exists.`);
    await this.record('created', row);
    return row;
  }

  /** 409 when it would switch off one of the engine's reasons (AC-IDN-57). */
  @Transactional()
  async update(
    code: string,
    dto: UpdateDeferralReasonDto,
  ): Promise<DeferralReasonRow> {
    const [before] = await this.txHost.tx
      .select()
      .from(deferralReasons)
      .where(eq(deferralReasons.code, code))
      .for('update');
    if (!before) throw new NotFoundError('deferral reason');
    if (before.fromEngine && dto.active === false)
      throw new StateConflictError(
        'The engine gives this reason, so it stays active. You can change its label.',
      );

    const [row] = await this.txHost.tx
      .update(deferralReasons)
      .set({
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.active !== undefined && { active: dto.active }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      })
      .where(eq(deferralReasons.code, code))
      .returning();
    await this.record('updated', row, before);
    return row;
  }

  private async record(
    verb: 'created' | 'updated',
    row: DeferralReasonRow,
    before?: DeferralReasonRow,
  ): Promise<void> {
    await this.audit.record({
      action: `planning.deferral_reason.${verb}`,
      entity: ['deferral_reason', row.code],
      before,
      after: row,
    });
    const payload: DeferralReasonEvent = { v: 1, code: row.code };
    await this.outbox.add(`deferral_reason.${verb}`, payload, {
      aggregate: ['deferral_reason', row.code],
    });
    this.log.info(
      { event: `planning.deferral_reason.${verb}`, code: row.code },
      `deferral reason ${verb}`,
    );
  }
}
