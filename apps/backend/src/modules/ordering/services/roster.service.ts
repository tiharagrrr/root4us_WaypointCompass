import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, asc, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  type FieldError,
  NotFoundError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { receivingRosterEntries } from '../../../db/schema';
import { AuditService } from '../../audit';
import type { SetReceivingRosterDto } from '../dto/receiving-roster.dto';
import { ORDER_AUDIT, ORDER_EVENTS } from '../ordering.constants';
import { ReceivingRosterScope } from '../policies/order.scope';

export type RosterEntryRow = typeof receivingRosterEntries.$inferSelect;

/**
 * Who receives deliveries at an outlet, and when (M3). The roster is kept a
 * day at a time: a PUT replaces that day's bands outright, which is how a
 * store manager edits the list without diffing it (AC-ORD-28). A roster for
 * another outlet simply is not there, so the request answers 404.
 *
 * Staff names are personal data, so they appear in the audit row's before and
 * after but never in a log line.
 */
@Injectable()
export class RosterService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: ReceivingRosterScope,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(RosterService.name);
  }

  async forDay(
    outletId: string,
    date: string,
    actor: Actor,
  ): Promise<RosterEntryRow[]> {
    if (!this.scope.covers(outletId, actor)) throw new NotFoundError('outlet');
    return this.entries(outletId, date);
  }

  /** PUT: the day's whole roster, replacing whatever was there. */
  @Transactional()
  async replaceDay(
    outletId: string,
    date: string,
    dto: SetReceivingRosterDto,
    actor: Actor,
  ): Promise<RosterEntryRow[]> {
    if (!this.scope.covers(outletId, actor)) throw new NotFoundError('outlet');
    this.checkBands(dto.entries);

    const before = await this.entries(outletId, date);
    await this.txHost.tx
      .delete(receivingRosterEntries)
      .where(
        and(
          eq(receivingRosterEntries.outletId, outletId),
          eq(receivingRosterEntries.date, date),
        ),
      );
    if (dto.entries.length)
      await this.txHost.tx
        .insert(receivingRosterEntries)
        .values(dto.entries.map((entry) => ({ ...entry, outletId, date })));
    const after = await this.entries(outletId, date);

    await this.audit.record({
      action: ORDER_AUDIT.rosterReplaced,
      entity: ['receiving_roster', `${outletId}#${date}`],
      before: { entries: before.map(shape) },
      after: { entries: after.map(shape) },
    });
    await this.outbox.add(
      ORDER_EVENTS.rosterReplaced,
      { v: 1, outletId, date, entries: after.length },
      {
        aggregate: ['receiving_roster', `${outletId}#${date}`],
        outletIds: [outletId],
      },
    );
    // Ids and counts only: a staff name never reaches a log line.
    this.log.info(
      {
        event: ORDER_AUDIT.rosterReplaced,
        outletId,
        date,
        entries: after.length,
      },
      'receiving roster replaced',
    );
    return after;
  }

  private entries(outletId: string, date: string): Promise<RosterEntryRow[]> {
    return this.txHost.tx
      .select()
      .from(receivingRosterEntries)
      .where(
        and(
          eq(receivingRosterEntries.outletId, outletId),
          eq(receivingRosterEntries.date, date),
        ),
      )
      .orderBy(
        asc(receivingRosterEntries.fromMin),
        asc(receivingRosterEntries.staffName),
      );
  }

  /** Each band ends after it starts (`roster_band_chk` says so too). */
  private checkBands(
    entries: readonly { fromMin: number; toMin: number }[],
  ): void {
    const errors: FieldError[] = [];
    entries.forEach((entry, i) => {
      if (entry.toMin <= entry.fromMin)
        errors.push({
          field: `entries[${i}].toMin`,
          code: 'after_from',
          message: 'The band must end after it starts.',
        });
    });
    if (errors.length) throw new ValidationError(errors);
  }
}

const shape = (e: RosterEntryRow) => ({
  staffName: e.staffName,
  fromMin: e.fromMin,
  toMin: e.toMin,
});
