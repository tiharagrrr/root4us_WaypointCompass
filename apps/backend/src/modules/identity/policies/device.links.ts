import { Injectable } from '@nestjs/common';
import { type Actor, can } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { DeviceDto } from '../dto/device.dto';
import type { DeviceAdminRow } from '../services/device.queries';

/** A registered device on A6: never its push keys, tokens or user agent. */
@Injectable()
export class DeviceLinks extends LinkBuilder<DeviceAdminRow, DeviceDto> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(d: DeviceAdminRow) {
    return `/api/v1/devices/${d.id}`;
  }

  protected actions(d: DeviceAdminRow, actor: Actor): LinkMap {
    const manage = can(actor, 'settings:manage');
    return {
      dock: manage && {
        href: `${this.self(d)}/dock`,
        method: 'PUT',
        title: d.isDockDevice ? 'Change depot' : 'Use as dock tablet',
      },
      undock: manage &&
        d.isDockDevice && {
          href: `${this.self(d)}/dock`,
          method: 'DELETE',
          title: 'Stop using as dock tablet',
        },
    };
  }

  protected present(d: DeviceAdminRow): DeviceDto {
    return {
      id: d.id,
      platform: d.platform,
      label: d.label,
      isDockDevice: d.isDockDevice,
      depotId: d.depotId,
      appVersion: d.appVersion,
      lastSeenAt: d.lastSeenAt ? this.clock.toIso(d.lastSeenAt) : null,
      createdAt: this.clock.toIso(d.createdAt),
    };
  }
}
