import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { type Actor, can } from '@waypoint/shared';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  ForbiddenError,
  ValidationError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { vehicles } from '../../../db/schema';
import { AuditService } from '../../audit';
import type { SetVehicleStatusDto } from '../dto/vehicle-status.dto';
import { FLEET_AUDIT, FLEET_EVENTS } from '../fleet.constants';
import { VehicleQueries, type VehicleRow } from './vehicle.queries';

/** Who may take a vehicle out or bring it back (AC-FLT-06). */
export const canSetStatus = (actor: Actor): boolean =>
  can(actor, 'masterData:manage') || can(actor, 'plan:revise');

/**
 * A vehicle's status with the reason for it (AC-FLT-05). The status stays
 * until someone marks the vehicle ACTIVE again; every change is audited and
 * emits `vehicle.status_changed`, which planning answers by flagging the
 * vehicle's trips for repair (ROO-56).
 */
@Injectable()
export class VehicleStatusService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly queries: VehicleQueries,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(VehicleStatusService.name);
  }

  @Transactional()
  async setStatus(
    id: string,
    version: number,
    dto: SetVehicleStatusDto,
    actor: Actor,
  ): Promise<VehicleRow> {
    if (!canSetStatus(actor))
      throw new ForbiddenError(
        'Only an admin or a dispatcher changes a vehicle’s status.',
      );
    const reason = dto.reason?.trim();
    if (!reason)
      throw new ValidationError([
        { field: 'reason', code: 'required', message: 'Say why' },
      ]);
    const before = await this.queries.get(id, actor);
    if (before.version !== version) throw new VersionMismatchError('vehicle');

    const [row] = await this.txHost.tx
      .update(vehicles)
      .set({
        status: dto.status,
        statusReason: reason,
        statusChangedAt: this.clock.now(),
        version: before.version + 1,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(vehicles.id, id), eq(vehicles.version, version)))
      .returning();
    if (!row) throw new VersionMismatchError('vehicle');

    await this.audit.record({
      action: FLEET_AUDIT.vehicleStatusChanged,
      entity: ['vehicle', id],
      before: { status: before.status },
      after: { status: row.status, statusReason: reason },
      reasonNote: reason,
    });
    await this.outbox.add(
      FLEET_EVENTS.vehicleStatusChanged,
      {
        v: 1,
        vehicleId: id,
        depotId: row.depotId,
        status: row.status,
        previousStatus: before.status,
        reason,
        at: this.clock.toIso(row.statusChangedAt ?? this.clock.now()),
      },
      { aggregate: ['vehicle', id], depotId: row.depotId },
    );
    this.log.info(
      {
        event: FLEET_AUDIT.vehicleStatusChanged,
        vehicleId: id,
        from: before.status,
        to: row.status,
      },
      'vehicle status changed',
    );
    return row;
  }
}
