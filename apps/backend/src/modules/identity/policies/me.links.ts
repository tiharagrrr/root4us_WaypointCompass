import { Injectable } from '@nestjs/common';
import { isUserRole, permissionsOf } from '@waypoint/shared';
import type { Collection } from '../../../core/http/envelope.interceptor';
import { ForbiddenError } from '../../../core/errors/domain-errors';
import type { DeviceDto } from '../dto/device.dto';
import type { MeDto } from '../dto/me.dto';
import type { DeviceRow } from '../services/devices.service';
import type { ProfileRow } from '../services/me.service';

const ME = '/api/v1/me';

/** Shapes /me and /me/devices, with the links the caller may follow. */
@Injectable()
export class MeLinks {
  me(row: ProfileRow): MeDto {
    if (!isUserRole(row.role))
      throw new ForbiddenError('This account has no Waypoint role.');
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      username: row.username,
      phoneNumber: row.phoneNumber,
      role: row.role,
      depotId: row.depotId,
      outletId: row.outletId,
      vehicleId: row.vehicleId,
      locale: row.locale,
      permissions: permissionsOf(row.role),
      _links: {
        self: { href: ME },
        edit: { href: ME, method: 'PATCH', title: 'Edit my settings' },
        devices: { href: `${ME}/devices` },
      },
    };
  }

  device(row: DeviceRow): DeviceDto {
    return {
      id: row.id,
      platform: row.platform,
      label: row.label,
      isDockDevice: row.isDockDevice,
      depotId: row.depotId,
      appVersion: row.appVersion,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  devices(rows: DeviceRow[]): Collection<DeviceDto> {
    return {
      items: rows.map((r) => this.device(r)),
      page: { limit: rows.length, offset: 0, total: rows.length },
      links: {
        self: { href: `${ME}/devices` },
        create: {
          href: `${ME}/devices`,
          method: 'POST',
          title: 'Register this device',
        },
      },
    };
  }
}
