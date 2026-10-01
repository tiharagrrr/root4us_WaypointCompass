import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  StateConflictError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { devices } from '../../../db/schema';
import { AuditService } from '../../audit';
import {
  type DeviceDockChangedEvent,
  IDENTITY_EVENTS,
} from '../events/identity.events';
import { DeviceScope } from '../policies/admin.scope';
import type { DeviceAdminRow } from './device.queries';
import { ReferenceChecks } from './reference-checks';

/**
 * Which registered devices are dock tablets, and for which depot (A6). Only
 * a dock device of that depot may sign a loader in with a PIN.
 */
@Injectable()
export class DockService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: DeviceScope,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly references: ReferenceChecks,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(DockService.name);
  }

  /** Marks a device as the dock tablet of a depot, or moves it to another depot. */
  @Transactional()
  async dock(
    id: string,
    depotId: string,
    actor: Actor,
  ): Promise<DeviceAdminRow> {
    const errors = await this.references.unknown({ depotId });
    if (errors.length) throw new ValidationError(errors);
    return this.change(id, { isDockDevice: true, depotId }, actor);
  }

  /** The device is an ordinary device again; PIN sign-in stops working on it. */
  @Transactional()
  async undock(id: string, actor: Actor): Promise<DeviceAdminRow> {
    return this.change(id, { isDockDevice: false, depotId: null }, actor);
  }

  private async change(
    id: string,
    next: { isDockDevice: boolean; depotId: string | null },
    actor: Actor,
  ): Promise<DeviceAdminRow> {
    const tx = this.txHost.tx;
    const [before] = await tx
      .select()
      .from(devices)
      .where(and(eq(devices.id, id), this.scope.where(actor)))
      .for('update');
    const device = this.scope.found(before);
    if (
      device.isDockDevice === next.isDockDevice &&
      device.depotId === next.depotId
    )
      throw new StateConflictError(
        next.isDockDevice
          ? 'This device is already the dock device for that depot.'
          : 'This device is not a dock device.',
      );

    const [row] = await tx
      .update(devices)
      .set(next)
      .where(eq(devices.id, id))
      .returning();
    await this.audit.record({
      action: IDENTITY_EVENTS.deviceDockChanged,
      entity: ['device', id],
      before: { isDockDevice: device.isDockDevice, depotId: device.depotId },
      after: next,
    });
    const payload: DeviceDockChangedEvent = { v: 1, deviceId: id, ...next };
    await this.outbox.add(IDENTITY_EVENTS.deviceDockChanged, payload, {
      aggregate: ['device', id],
      depotId: next.depotId ?? device.depotId,
    });
    this.log.info(
      { event: IDENTITY_EVENTS.deviceDockChanged, deviceId: id, ...next },
      next.isDockDevice ? 'dock device set' : 'dock device cleared',
    );
    return row;
  }
}
