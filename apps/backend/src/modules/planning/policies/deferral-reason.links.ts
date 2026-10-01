import { Injectable } from '@nestjs/common';
import { type Actor, can } from '@waypoint/shared';
import type { Collection } from '../../../core/http/envelope.interceptor';
import { compact } from '../../../core/http/links';
import type { DeferralReasonDto } from '../dto/deferral-reason.dto';
import type { DeferralReasonRow } from '../services/deferral-reasons.service';

const BASE = '/api/v1/deferral-reasons';

/** Deferral reasons with what the caller may change (A6). */
@Injectable()
export class DeferralReasonLinks {
  one(r: DeferralReasonRow, actor: Actor): DeferralReasonDto {
    const manage = can(actor, 'settings:manage');
    const self = `${BASE}/${r.code}`;
    return {
      code: r.code,
      label: r.label,
      description: r.description,
      fromEngine: r.fromEngine,
      active: r.active,
      sortOrder: r.sortOrder,
      _links: compact({
        self: { href: self },
        edit: manage && { href: self, method: 'PATCH', title: 'Edit' },
        deactivate: manage &&
          r.active &&
          !r.fromEngine && {
            href: self,
            method: 'PATCH',
            title: 'Turn off',
          },
        activate: manage &&
          !r.active && { href: self, method: 'PATCH', title: 'Turn on' },
      }),
    };
  }

  list(rows: DeferralReasonRow[], actor: Actor): Collection<DeferralReasonDto> {
    return {
      items: rows.map((r) => this.one(r, actor)),
      page: { limit: rows.length, offset: 0, total: rows.length },
      links: compact({
        self: { href: BASE },
        create: can(actor, 'settings:manage') && {
          href: BASE,
          method: 'POST',
          title: 'Add reason',
        },
      }),
    };
  }
}
