import { Injectable } from '@nestjs/common';
import { type Actor, can, minuteLabel, stopMachine } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { StopDto } from '../dto/stop.dto';
import type { StopView } from '../services/stop.queries';

const BASE = '/api/v1/stops';

/**
 * A stop with the actions allowed right now. The links come from
 * `stopMachine` and the trip's own status, so D3's Arrive appears only on a
 * started trip and D4's Deliver only after arriving — and once an outcome is
 * recorded, nothing is offered at all, because the event log is append-only
 * (AC-EXE-13).
 */
@Injectable()
export class StopLinks extends LinkBuilder<StopView, Omit<StopDto, '_links'>> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(stop: StopView) {
    return `${BASE}/${stop.id}`;
  }

  protected actions(stop: StopView, actor: Actor): LinkMap {
    const self = this.self(stop);
    const records =
      can(actor, 'stop:record') &&
      stop.tripDriverId === actor.id &&
      stop.tripStatus === 'IN_PROGRESS';
    return {
      trip: { href: `/api/v1/trips/${stop.tripId}` },
      order: { href: `/api/v1/orders/${stop.orderId}` },
      arrive: records &&
        stopMachine.can(stop.status, 'ARRIVE') && {
          href: `${self}/arrive`,
          method: 'POST',
          title: 'I am here',
        },
      complete: records &&
        stopMachine.can(stop.status, 'DELIVER') && {
          href: `${self}/complete`,
          method: 'POST',
          title: 'Delivered',
          requires: ['receiverName', 'attachmentUuids'],
        },
      fail: records &&
        stopMachine.can(stop.status, 'FAIL') && {
          href: `${self}/fail`,
          method: 'POST',
          title: 'Could not deliver',
          requires: ['outcome', 'note'],
        },
    };
  }

  protected present(stop: StopView): Omit<StopDto, '_links'> {
    const iso = (at: Date | null) => (at ? this.clock.toIso(at) : null);
    return {
      id: stop.id,
      tripId: stop.tripId,
      orderId: stop.orderId,
      outletId: stop.outletId,
      outletName: stop.outletName,
      seq: stop.seq,
      status: stop.status,
      window: {
        openMin: stop.windowOpenMin,
        open: minuteLabel(stop.windowOpenMin),
        closeMin: stop.windowCloseMin,
        close: minuteLabel(stop.windowCloseMin),
      },
      plannedArrivalAt: iso(stop.plannedArrivalAt),
      arrivedAt: iso(stop.arrivedAt),
      completedAt: iso(stop.completedAt),
      outcome: stop.outcome,
      receiverName: stop.receiverName,
      exceptionNote: stop.exceptionNote,
      unitsDelivered: stop.unitsDelivered,
      version: stop.version,
    };
  }
}
