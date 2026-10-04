import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  type FieldError,
  NotFoundError,
  StateConflictError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { depots, depotWaves, trips } from '../../../db/schema';
import { AuditService } from '../../audit';
import type {
  CreateDepotWaveDto,
  UpdateDepotWaveDto,
} from '../dto/depot-wave.dto';

export type DepotWaveRow = typeof depotWaves.$inferSelect;

export const DEPOT_WAVES_UPDATED = 'depot.waves_updated';

/** depot.waves_updated: realtime refreshes A4 and the planner's wave picker. */
export type DepotWavesUpdatedEvent = { v: 1; id: string };

/**
 * Run 1 and Run 2, the departure bands trips are planned in (A4, AC-MD-07).
 * One label per depot, a band that ends after it starts, and a wave trips
 * already sit in stays until those trips are gone. Every change is audited on
 * the depot, because a wave only means anything as part of one.
 */
@Injectable()
export class DepotWavesService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(DepotWavesService.name);
  }

  /** The depot's waves, earliest band first, as A4 lists them. */
  async list(depotId: string): Promise<DepotWaveRow[]> {
    await this.depot(depotId);
    return this.txHost.tx
      .select()
      .from(depotWaves)
      .where(eq(depotWaves.depotId, depotId))
      .orderBy(asc(depotWaves.departFromMin), asc(depotWaves.label));
  }

  async get(depotId: string, id: string): Promise<DepotWaveRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(depotWaves)
      .where(and(eq(depotWaves.id, id), eq(depotWaves.depotId, depotId)));
    if (!row) throw new NotFoundError('wave');
    return row;
  }

  @Transactional()
  async create(
    depotId: string,
    dto: CreateDepotWaveDto,
  ): Promise<DepotWaveRow> {
    await this.depot(depotId);
    this.checkBand(dto.departFromMin, dto.departToMin);
    await this.checkLabel(depotId, dto.label);

    const [row] = await this.txHost.tx
      .insert(depotWaves)
      .values({ ...dto, depotId })
      .returning();
    await this.recordAndEmit('created', row);
    return row;
  }

  @Transactional()
  async update(
    depotId: string,
    id: string,
    dto: UpdateDepotWaveDto,
  ): Promise<DepotWaveRow> {
    const before = await this.get(depotId, id);
    const next = {
      label: dto.label ?? before.label,
      departFromMin: dto.departFromMin ?? before.departFromMin,
      departToMin: dto.departToMin ?? before.departToMin,
      brands: dto.brands ?? before.brands,
    };
    this.checkBand(next.departFromMin, next.departToMin);
    if (next.label !== before.label) await this.checkLabel(depotId, next.label);

    const [row] = await this.txHost.tx
      .update(depotWaves)
      .set(next)
      .where(eq(depotWaves.id, id))
      .returning();
    await this.recordAndEmit('updated', row, before);
    return row;
  }

  @Transactional()
  async remove(depotId: string, id: string): Promise<void> {
    const before = await this.get(depotId, id);
    const [planned] = await this.txHost.tx
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.waveId, id))
      .limit(1);
    if (planned)
      throw new StateConflictError(
        'Trips are planned in this wave. Move them to another wave first.',
      );

    await this.txHost.tx.delete(depotWaves).where(eq(depotWaves.id, id));
    await this.recordAndEmit('removed', before);
  }

  /** 404 when the depot in the path does not exist. */
  private async depot(depotId: string): Promise<void> {
    const [row] = await this.txHost.tx
      .select({ id: depots.id })
      .from(depots)
      .where(eq(depots.id, depotId));
    if (!row) throw new NotFoundError('depot');
  }

  private checkBand(fromMin: number, toMin: number): void {
    if (toMin < fromMin) {
      const error: FieldError = {
        field: 'departToMin',
        code: 'after_open',
        message: 'The band must end at or after it starts.',
      };
      throw new ValidationError([error]);
    }
  }

  private async checkLabel(depotId: string, label: string): Promise<void> {
    const [clash] = await this.txHost.tx
      .select({ id: depotWaves.id })
      .from(depotWaves)
      .where(and(eq(depotWaves.depotId, depotId), eq(depotWaves.label, label)));
    if (clash)
      throw new StateConflictError(
        `${depotId} already has a wave called ${label}.`,
      );
  }

  private async recordAndEmit(
    verb: 'created' | 'updated' | 'removed',
    row: DepotWaveRow,
    before?: DepotWaveRow,
  ): Promise<void> {
    await this.audit.record({
      action: `master_data.depot_wave.${verb}`,
      entity: ['depot_wave', row.id],
      before,
      after: verb === 'removed' ? undefined : row,
    });
    const payload: DepotWavesUpdatedEvent = { v: 1, id: row.depotId };
    await this.outbox.add(DEPOT_WAVES_UPDATED, payload, {
      aggregate: ['depot', row.depotId],
      depotId: row.depotId,
    });
    this.log.info(
      {
        event: `master_data.depot_wave.${verb}`,
        depotId: row.depotId,
        waveId: row.id,
      },
      'depot wave changed',
    );
  }
}
