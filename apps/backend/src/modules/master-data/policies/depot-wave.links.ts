import { Injectable } from '@nestjs/common';
import { type Actor, can, minuteLabel } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { DepotWaveDto } from '../dto/depot-wave.dto';
import type { DepotWaveRow } from '../services/depot-waves.service';

/** A wave on A4, with edit and remove for whoever may make them. */
@Injectable()
export class DepotWaveLinks extends LinkBuilder<
  DepotWaveRow,
  Omit<DepotWaveDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(w: DepotWaveRow) {
    return `/api/v1/depots/${w.depotId}/waves/${w.id}`;
  }

  protected actions(w: DepotWaveRow, actor: Actor): LinkMap {
    const manage = can(actor, 'masterData:manage');
    return {
      depot: { href: `/api/v1/depots/${w.depotId}`, title: 'Depot' },
      edit: manage && {
        href: this.self(w),
        method: 'PATCH',
        title: 'Edit wave',
      },
      remove: manage && {
        href: this.self(w),
        method: 'DELETE',
        title: 'Remove wave',
      },
    };
  }

  protected present(w: DepotWaveRow): Omit<DepotWaveDto, '_links'> {
    return {
      id: w.id,
      depotId: w.depotId,
      label: w.label,
      departFromMin: w.departFromMin,
      departFrom: minuteLabel(w.departFromMin),
      departToMin: w.departToMin,
      departTo: minuteLabel(w.departToMin),
      brands: w.brands,
    };
  }
}
