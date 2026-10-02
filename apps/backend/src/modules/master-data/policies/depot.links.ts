import { Injectable } from '@nestjs/common';
import { type Actor, can, minuteLabel } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { DepotDto } from '../dto/depot.dto';
import type { DepotRow } from '../services/reference.queries';

/** A depot row with the cutoff minute that is actually in force for it. */
export type DepotView = DepotRow & { effectiveCutoffMin: number };

/** A depot on A4, and the day link 01 and 03 start their day from. */
@Injectable()
export class DepotLinks extends LinkBuilder<
  DepotView,
  Omit<DepotDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(d: DepotView) {
    return `/api/v1/depots/${d.id}`;
  }

  protected actions(d: DepotView, actor: Actor): LinkMap {
    return {
      edit: can(actor, 'masterData:manage') && {
        href: this.self(d),
        method: 'PATCH',
        title: 'Edit depot',
      },
      today: can(actor, 'order:read') && {
        href: `${this.self(d)}/days/${this.clock.businessDate()}`,
        title: 'Today at this depot',
      },
    };
  }

  protected present(d: DepotView): Omit<DepotDto, '_links'> {
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      address: d.address,
      lat: d.lat,
      lng: d.lng,
      dockCount: d.dockCount,
      chilledDocks: d.chilledDocks,
      cutoffMin: d.cutoffMin,
      effectiveCutoffMin: d.effectiveCutoffMin,
      effectiveCutoff: minuteLabel(d.effectiveCutoffMin),
    };
  }
}
