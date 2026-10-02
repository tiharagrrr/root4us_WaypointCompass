import { Injectable } from '@nestjs/common';
import { type Actor, can, minuteLabel } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { OutletDto } from '../dto/outlet.dto';
import type { OutletRow } from '../services/outlet.queries';

const label = (min: number | null) => (min == null ? null : minuteLabel(min));

/** An outlet on A3, with the edit link only for someone who may make it. */
@Injectable()
export class OutletLinks extends LinkBuilder<
  OutletRow,
  Omit<OutletDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(o: OutletRow) {
    return `/api/v1/outlets/${o.id}`;
  }

  protected actions(o: OutletRow, actor: Actor): LinkMap {
    return {
      edit: can(actor, 'masterData:manage') && {
        href: this.self(o),
        method: 'PATCH',
        title: 'Edit outlet',
      },
      receivingRoster: can(actor, 'order:update') && {
        href: `${this.self(o)}/receiving-roster`,
        title: 'Receiving roster',
        templated: true,
      },
    };
  }

  protected present(o: OutletRow): Omit<OutletDto, '_links'> {
    return {
      id: o.id,
      name: o.name,
      brand: o.brand,
      districtId: o.districtId,
      depotId: o.depotId,
      dockType: o.dockType,
      parkingConstraint: o.parkingConstraint,
      windowOpenMin: o.windowOpenMin,
      windowOpen: minuteLabel(o.windowOpenMin),
      windowCloseMin: o.windowCloseMin,
      windowClose: minuteLabel(o.windowCloseMin),
      mallWindowOpenMin: o.mallWindowOpenMin,
      mallWindowOpen: label(o.mallWindowOpenMin),
      mallWindowCloseMin: o.mallWindowCloseMin,
      mallWindowClose: label(o.mallWindowCloseMin),
      styleDeliveryDow: o.styleDeliveryDow,
      address: o.address,
      lat: o.lat,
      lng: o.lng,
      receivingContactName: o.receivingContactName,
      receivingContactPhone: o.receivingContactPhone,
      accessNotes: o.accessNotes,
      accessNotesUpdatedAt: o.accessNotesUpdatedAt
        ? this.clock.toIso(o.accessNotesUpdatedAt)
        : null,
      accessNotesUpdatedById: o.accessNotesUpdatedById,
    };
  }
}
