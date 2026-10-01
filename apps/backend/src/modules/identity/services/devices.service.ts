import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import type { Actor } from '../../../core/http/decorators';
import type { Database } from '../../../db/client';
import { DB } from '../../../db/database.module';
import { devices } from '../../../db/schema';
import type { RegisterDeviceDto } from '../dto/device.dto';

/** The columns a device response shows: never push keys or tokens. */
const DEVICE = {
  id: devices.id,
  platform: devices.platform,
  label: devices.label,
  isDockDevice: devices.isDockDevice,
  depotId: devices.depotId,
  appVersion: devices.appVersion,
  lastSeenAt: devices.lastSeenAt,
  createdAt: devices.createdAt,
};

export interface DeviceRow {
  id: string;
  platform: 'WEB' | 'PWA' | 'FLUTTER';
  label: string | null;
  isDockDevice: boolean;
  depotId: string | null;
  appVersion: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}

/**
 * The caller's devices. The id is made on the device and kept in IndexedDB;
 * registering again updates the row, and a shared dock tablet moves to the
 * loader now using it. Whether a device is a dock device, and for which
 * depot, only an admin decides (PUT /devices/{id}/dock).
 */
@Injectable()
export class DevicesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
  ) {}

  list(actor: Actor): Promise<DeviceRow[]> {
    return this.db
      .select(DEVICE)
      .from(devices)
      .where(eq(devices.userId, actor.id))
      .orderBy(asc(devices.createdAt), asc(devices.id));
  }

  /** Upserts the device for the caller; `created` is false when it was already known. */
  async register(
    actor: Actor,
    dto: RegisterDeviceDto,
    userAgent: string | undefined,
  ): Promise<{ device: DeviceRow; created: boolean }> {
    const values = {
      userId: actor.id,
      platform: dto.platform,
      appVersion: dto.appVersion ?? null,
      userAgent: userAgent ?? null,
      lastSeenAt: this.clock.realNow(),
      ...(dto.label !== undefined && { label: dto.label }),
    };
    const [existing] = await this.db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.id, dto.id));
    const [device] = existing
      ? await this.db
          .update(devices)
          .set(values)
          .where(eq(devices.id, dto.id))
          .returning(DEVICE)
      : await this.db
          .insert(devices)
          .values({ id: dto.id, ...values })
          .returning(DEVICE);
    return { device, created: !existing };
  }
}
