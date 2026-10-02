import { Injectable } from '@nestjs/common';
import { type Actor, can, minuteLabel } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { compact } from '../../../core/http/links';
import { AppConfig } from '../../../config/app-config';
import type {
  CloseCutoffResultDto,
  DepotDaySummaryDto,
} from '../dto/depot-day.dto';
import type { CloseResult } from '../services/cutoff-close.service';
import type { DepotDaySummary } from '../services/depot-day.queries';

/**
 * A depot's delivery day for 01 and 03: the counts, the cutoff state, and the
 * queue the dispatcher opens from it. `closeCutoff` appears only in demo
 * mode, and only for someone who may run the queue, because the ticker
 * normally closes the day on its own (AC-ORD-25).
 */
@Injectable()
export class DepotDayLinks {
  constructor(
    private readonly clock: ClockService,
    private readonly config: AppConfig,
  ) {}

  one(day: DepotDaySummary, actor: Actor): DepotDaySummaryDto {
    const self = `/api/v1/depots/${day.depotId}/days/${day.date}`;
    const queue = `/api/v1/orders?filter[depotId]=${day.depotId}&filter[deliveryDate]=${day.date}`;
    return {
      depotId: day.depotId,
      date: day.date,
      total: day.total,
      byStatus: day.byStatus,
      byBrand: day.byBrand,
      byClass: day.byClass,
      urgent: day.urgent,
      afterCutoff: day.afterCutoff,
      units: day.units,
      weightKg: day.weightKg,
      volumeM3: day.volumeM3,
      cutoff: {
        at: this.clock.toIso(day.cutoff.at),
        cutoffMin: day.cutoff.cutoffMin,
        passed: day.cutoff.passed,
        closed: day.cutoff.closed,
        closedAt: day.cutoff.closedAt
          ? this.clock.toIso(day.cutoff.closedAt)
          : null,
        minutesLeft: day.cutoff.minutesLeft,
      },
      _links: compact({
        self: { href: self },
        depot: { href: `/api/v1/depots/${day.depotId}` },
        orders: { href: queue, title: `Orders for ${day.date}` },
        closeCutoff: this.config.demo.enabled &&
          !day.cutoff.closed &&
          can(actor, 'order:queue') && {
            href: `${self}/close-cutoff`,
            method: 'POST',
            title: `Close the ${minuteLabel(day.cutoff.cutoffMin)} cutoff now`,
          },
      }),
    };
  }

  closed(result: CloseResult): CloseCutoffResultDto {
    const self = `/api/v1/depots/${result.depotId}/days/${result.deliveryDate}`;
    return {
      depotId: result.depotId,
      date: result.deliveryDate,
      confirmed: result.confirmed,
      closed: result.closed,
      _links: { day: { href: self } },
    };
  }
}
