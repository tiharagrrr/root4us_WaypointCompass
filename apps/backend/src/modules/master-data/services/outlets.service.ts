import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  type FieldError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { outlets } from '../../../db/schema';
import { AuditService } from '../../audit';
import type { UpdateOutletDto } from '../dto/outlet.dto';
import { OutletScope } from '../policies/master-data.scope';
import type { OutletRow } from './outlet.queries';

export const OUTLET_UPDATED = 'outlet.updated';

/** outlet.updated: realtime refreshes A3, execution refreshes D9's bundle. */
export type OutletUpdatedEvent = { v: 1; id: string };

/**
 * The outlet edits A3 makes: windows, dock, parking, the receiving contact
 * and D9's access notes. Each is audited with before and after in the same
 * transaction as the write, and announced as `outlet.updated` (AC-MD-02).
 * Log lines carry the outlet id only, never the contact's name or phone.
 */
@Injectable()
export class OutletsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: OutletScope,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(OutletsService.name);
  }

  @Transactional()
  async update(
    id: string,
    dto: UpdateOutletDto,
    actor: Actor,
  ): Promise<OutletRow> {
    const before = await this.load(id, actor);
    const changes = this.changesOf(dto, before, actor);
    if (Object.keys(changes).length === 0) return before;

    const [row] = await this.txHost.tx
      .update(outlets)
      .set({ ...changes, updatedAt: this.clock.realNow() })
      .where(eq(outlets.id, id))
      .returning();

    await this.audit.record({
      action: 'master_data.outlet.updated',
      entity: ['outlet', id],
      before,
      after: row,
    });
    const payload: OutletUpdatedEvent = { v: 1, id };
    await this.outbox.add(OUTLET_UPDATED, payload, {
      aggregate: ['outlet', id],
      depotId: row.depotId,
      outletIds: [id],
    });
    this.log.info(
      {
        event: 'master_data.outlet.updated',
        outletId: id,
        fields: Object.keys(changes).sort(),
      },
      'outlet updated',
    );
    return row;
  }

  /** The outlet, locked for this transaction; 404 when missing or out of scope. */
  private async load(id: string, actor: Actor): Promise<OutletRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(outlets)
      .where(and(eq(outlets.id, id), this.scope.where(actor)))
      .for('update');
    return this.scope.found(row);
  }

  /**
   * The fields that actually change, checked against the window rules the
   * database also enforces, so a bad patch names its field rather than its
   * constraint (AC-MD-01).
   */
  private changesOf(
    dto: UpdateOutletDto,
    before: OutletRow,
    actor: Actor,
  ): Partial<typeof outlets.$inferInsert> {
    const next = {
      dockType: dto.dockType ?? before.dockType,
      parkingConstraint: dto.parkingConstraint ?? before.parkingConstraint,
      windowOpenMin: dto.windowOpenMin ?? before.windowOpenMin,
      windowCloseMin: dto.windowCloseMin ?? before.windowCloseMin,
      mallWindowOpenMin:
        dto.mallWindowOpenMin === undefined
          ? before.mallWindowOpenMin
          : dto.mallWindowOpenMin,
      mallWindowCloseMin:
        dto.mallWindowCloseMin === undefined
          ? before.mallWindowCloseMin
          : dto.mallWindowCloseMin,
      receivingContactName:
        dto.receivingContactName === undefined
          ? before.receivingContactName
          : dto.receivingContactName,
      receivingContactPhone:
        dto.receivingContactPhone === undefined
          ? before.receivingContactPhone
          : dto.receivingContactPhone,
      accessNotes:
        dto.accessNotes === undefined ? before.accessNotes : dto.accessNotes,
    };

    const errors: FieldError[] = [];
    if (next.windowCloseMin <= next.windowOpenMin)
      errors.push({
        field: 'windowCloseMin',
        code: 'after_open',
        message: 'The window must close after it opens.',
      });
    const halfMall =
      (next.mallWindowOpenMin == null) !== (next.mallWindowCloseMin == null);
    if (halfMall)
      errors.push({
        field:
          next.mallWindowOpenMin == null
            ? 'mallWindowOpenMin'
            : 'mallWindowCloseMin',
        code: 'required',
        message: 'Give both ends of the mall window, or neither.',
      });
    if (
      !halfMall &&
      next.mallWindowOpenMin != null &&
      next.mallWindowCloseMin != null &&
      next.mallWindowCloseMin <= next.mallWindowOpenMin
    )
      errors.push({
        field: 'mallWindowCloseMin',
        code: 'after_open',
        message: 'The mall window must close after it opens.',
      });
    if (errors.length) throw new ValidationError(errors);

    const changed: Partial<typeof outlets.$inferInsert> = {};
    for (const [key, value] of Object.entries(next)) {
      if (before[key as keyof OutletRow] !== value)
        Object.assign(changed, { [key]: value });
    }
    // D9 shows who last touched the access notes, and when.
    if ('accessNotes' in changed) {
      changed.accessNotesUpdatedAt = this.clock.now();
      changed.accessNotesUpdatedById = actor.id;
    }
    return changed;
  }
}
