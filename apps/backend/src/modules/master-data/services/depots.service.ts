import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  NotFoundError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { depots } from '../../../db/schema';
import { AuditService } from '../../audit';
import type { UpdateDepotDto } from '../dto/depot.dto';
import type { DepotRow } from './reference.queries';

export const DEPOT_UPDATED = 'depot.updated';

export type DepotUpdatedEvent = { v: 1; id: string };

/**
 * Depot settings on A4: docks, chilled docks and the cutoff override that
 * moves the whole depot's order deadline (AC-MD-06, AC-ORD-23).
 */
@Injectable()
export class DepotsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(DepotsService.name);
  }

  @Transactional()
  async update(id: string, dto: UpdateDepotDto): Promise<DepotRow> {
    const [before] = await this.txHost.tx
      .select()
      .from(depots)
      .where(eq(depots.id, id))
      .for('update');
    if (!before) throw new NotFoundError('depot');

    const next = {
      dockCount: dto.dockCount ?? before.dockCount,
      chilledDocks: dto.chilledDocks ?? before.chilledDocks,
      cutoffMin: dto.cutoffMin === undefined ? before.cutoffMin : dto.cutoffMin,
    };
    if (next.chilledDocks > next.dockCount)
      throw new ValidationError([
        {
          field: 'chilledDocks',
          code: 'max',
          message: 'A depot cannot have more chilled docks than docks.',
        },
      ]);

    const [row] = await this.txHost.tx
      .update(depots)
      .set({ ...next, updatedAt: this.clock.realNow() })
      .where(eq(depots.id, id))
      .returning();

    await this.audit.record({
      action: 'master_data.depot.updated',
      entity: ['depot', id],
      before,
      after: row,
    });
    const payload: DepotUpdatedEvent = { v: 1, id };
    await this.outbox.add(DEPOT_UPDATED, payload, {
      aggregate: ['depot', id],
      depotId: id,
    });
    this.log.info(
      { event: 'master_data.depot.updated', depotId: id },
      'depot updated',
    );
    return row;
  }
}
