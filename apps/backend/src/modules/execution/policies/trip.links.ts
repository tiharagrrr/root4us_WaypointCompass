import { Injectable } from '@nestjs/common';
import { type Actor, can, tripMachine } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { TripSummaryDto } from '../dto/trip.dto';
import type { TripSummaryRow } from '../services/my-trips.queries';

const BASE = '/api/v1/trips';

/**
 * A trip as D1, D10 and D14 read it, with the actions allowed right now.
 * Every action link is built from `tripMachine` and the caller's permission,
 * the same two things the service checks, so D1 shows Start exactly when
 * starting would succeed (architecture rule 9).
 */
@Injectable()
export class TripLinks extends LinkBuilder<
  TripSummaryRow,
  Omit<TripSummaryDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(trip: TripSummaryRow) {
    return `${BASE}/${trip.id}`;
  }

  protected actions(trip: TripSummaryRow, actor: Actor): LinkMap {
    const self = this.self(trip);
    const records = can(actor, 'stop:record') && trip.driverId === actor.id;
    return {
      offlineBundle: {
        href: `${self}/offline-bundle`,
        title: 'Download for offline',
      },
      downloaded: records && {
        href: `${self}/downloaded`,
        method: 'POST',
        title: 'Confirm the download',
      },
      start: records &&
        tripMachine.can(trip.status, 'START') && {
          href: `${self}/start`,
          method: 'POST',
          title: 'Start trip',
        },
      // The trip ends only once every stop has a result (AC-EXE-15), so D7's
      // button appears exactly then.
      complete: records &&
        tripMachine.can(trip.status, 'COMPLETE') &&
        trip.openStops === 0 && {
          href: `${self}/complete`,
          method: 'POST',
          title: 'Finish trip',
        },
      cantRun: records &&
        (trip.status === 'RELEASED' || trip.status === 'IN_PROGRESS') &&
        !trip.cantRunReason && {
          href: `${self}/cant-run`,
          method: 'POST',
          title: "Can't run this trip",
        },
      // 20 and 19b (planning's endpoints): offered on the same machine and
      // permission planning checks; planning also refuses a trip on a plan
      // that is not published, which 19a only shows for published days.
      reassign: can(actor, 'trip:reassign') &&
        tripMachine.can(trip.status, 'REASSIGN') && {
          href: `${self}/reassign`,
          method: 'POST',
          title: 'Reassign',
          requires: ['If-Match', 'Idempotency-Key'],
        },
      resequence: can(actor, 'trip:resequence') &&
        ['PLANNED', 'LOADING', 'RELEASED', 'IN_PROGRESS'].includes(
          trip.status,
        ) &&
        trip.openStops > 1 && {
          href: `${self}/resequence`,
          method: 'POST',
          title: 'Re-sequence',
          requires: ['If-Match', 'Idempotency-Key'],
        },
    };
  }

  protected present(trip: TripSummaryRow): Omit<TripSummaryDto, '_links'> {
    const iso = (at: Date | null) => (at ? this.clock.toIso(at) : null);
    return {
      id: trip.id,
      tripNo: trip.tripNo,
      status: trip.status,
      date: trip.date,
      depotId: trip.depotId,
      brand: trip.brand,
      tempClass: trip.tempClass,
      vehicle: {
        id: trip.vehicleId,
        code: trip.vehicleCode,
        temp: trip.vehicleTemp,
      },
      stops: trip.stops,
      openStops: trip.openStops,
      plannedDepartAt: iso(trip.plannedDepartAt),
      releasedAt: iso(trip.releasedAt),
      downloadedAt: iso(trip.downloadedAt),
      startedAt: iso(trip.startedAt),
      completedAt: iso(trip.completedAt),
      cantRunReason: trip.cantRunReason,
      version: trip.version,
    };
  }
}
