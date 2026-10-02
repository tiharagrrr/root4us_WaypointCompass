import { Injectable } from '@nestjs/common';
import { type Actor, can, minuteLabel } from '@waypoint/shared';
import { compact } from '../../../core/http/links';
import type { ReceivingRosterDto } from '../dto/receiving-roster.dto';
import type { RosterEntryRow } from '../services/roster.service';

/** One outlet's receiving roster for a day, with the link that replaces it. */
@Injectable()
export class ReceivingRosterLinks {
  one(
    outletId: string,
    date: string,
    entries: RosterEntryRow[],
    actor: Actor,
  ): ReceivingRosterDto {
    const self = `/api/v1/outlets/${outletId}/receiving-roster?date=${date}`;
    return {
      outletId,
      date,
      entries: entries.map((e) => ({
        id: e.id,
        staffName: e.staffName,
        fromMin: e.fromMin,
        from: minuteLabel(e.fromMin),
        toMin: e.toMin,
        to: minuteLabel(e.toMin),
      })),
      _links: compact({
        self: { href: self },
        outlet: { href: `/api/v1/outlets/${outletId}` },
        replace: can(actor, 'order:update') && {
          href: self,
          method: 'PUT',
          title: "Replace the day's roster",
        },
      }),
    };
  }
}
