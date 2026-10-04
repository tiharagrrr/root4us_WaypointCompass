import { Injectable } from '@nestjs/common';
import { type Actor, can } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { VehicleDto } from '../dto/vehicle.dto';
import { canSetStatus } from '../services/vehicle-status.service';
import type { VehicleView } from '../services/vehicle.queries';

/**
 * A vehicle on A5 and on the cards on 06 and 09. Edit is an admin's
 * (`masterData:manage`), the status an admin's or a dispatcher's, and the
 * week's fuel a planner's — each link built from the same check the endpoint
 * makes (AC-FLT-06).
 */
@Injectable()
export class VehicleLinks extends LinkBuilder<
  VehicleView,
  Omit<VehicleDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(v: VehicleView) {
    return `/api/v1/vehicles/${v.id}`;
  }

  protected actions(v: VehicleView, actor: Actor): LinkMap {
    return {
      edit: can(actor, 'masterData:manage') && {
        href: this.self(v),
        method: 'PATCH',
        title: 'Edit vehicle',
        requires: ['If-Match'],
      },
      status: canSetStatus(actor) && {
        href: `${this.self(v)}/status`,
        method: 'PUT',
        title: 'Set status',
        requires: ['If-Match'],
      },
      fuel: can(actor, 'plan:read') && {
        href: `${this.self(v)}/fuel{?week}`,
        title: "This week's fuel",
        templated: true,
      },
    };
  }

  protected present(v: VehicleView): Omit<VehicleDto, '_links'> {
    return {
      id: v.id,
      code: v.code,
      registrationNo: v.registrationNo,
      type: v.type,
      temp: v.temp,
      weightCapKg: v.weightCapKg,
      volumeCapM3: v.volumeCapM3,
      fuelType: v.fuelType,
      kmPerL: v.kmPerL,
      weeklyFuelQuotaL: v.weeklyFuelQuotaL,
      depotId: v.depotId,
      status: v.status,
      statusReason: v.statusReason,
      statusChangedAt: v.statusChangedAt
        ? this.clock.toIso(v.statusChangedAt)
        : null,
      driver: v.driver,
      version: v.version,
    };
  }
}
