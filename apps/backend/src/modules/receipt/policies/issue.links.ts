import { Injectable } from '@nestjs/common';
import { type Actor, can } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { IssueDto } from '../dto/issue.dto';
import { REOPEN_WINDOW_HOURS } from '../receipt.constants';
import type { IssueView } from '../services/issue.queries';

const HOUR_MS = 3_600_000;

/** Whether a resolved issue may still be reopened: within 48 hours of its resolution, inclusive. */
export function withinReopenWindow(
  resolvedAt: Date | null,
  now: Date,
): boolean {
  return (
    resolvedAt !== null &&
    now.getTime() - resolvedAt.getTime() <= REOPEN_WINDOW_HOURS * HOUR_MS
  );
}

/**
 * An issue and what the caller may do with it: comment on it, resolve it (dispatcher),
 * reopen it (the store, for 48 hours), add a photo. Each link appears only when the
 * state, the permission and the time allow it, from the same rule the command checks.
 */
@Injectable()
export class IssueLinks extends LinkBuilder<IssueView, IssueDto> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(i: IssueView) {
    return `/api/v1/issues/${i.id}`;
  }

  protected actions(i: IssueView, actor: Actor, now: Date): LinkMap {
    const resolved = i.status === 'RESOLVED';
    const reader = can(actor, 'issue:read');
    return {
      order:
        i.orderId && reader
          ? { href: `/api/v1/orders/${i.orderId}` }
          : undefined,
      comments: reader && { href: `${this.self(i)}/comments` },
      comment: reader &&
        (can(actor, 'issue:create') || can(actor, 'issue:resolve')) && {
          href: `${this.self(i)}/comments`,
          method: 'POST',
          title: 'Comment',
        },
      resolve: !resolved &&
        can(actor, 'issue:resolve') && {
          href: `${this.self(i)}/resolve`,
          method: 'POST',
          title: 'Resolve',
        },
      reopen: resolved &&
        actor.role === 'store_manager' &&
        can(actor, 'issue:create') &&
        withinReopenWindow(i.resolvedAt, now) && {
          href: `${this.self(i)}/reopen`,
          method: 'POST',
          title: 'Reopen',
        },
      photo: !resolved &&
        can(actor, 'issue:create') && {
          href: `${this.self(i)}/attachments/presign`,
          method: 'POST',
          title: 'Add a photo',
        },
    };
  }

  protected present(i: IssueView): IssueDto {
    const iso = (at: Date | null) => (at ? this.clock.toIso(at) : null);
    return {
      id: i.id,
      outletId: i.outletId,
      orderId: i.orderId,
      orderNo: i.orderNo,
      stopId: i.stopId,
      receiptId: i.receiptId,
      orderLineId: i.orderLineId,
      type: i.type,
      qtyAffected: i.qtyAffected,
      description: i.description,
      status: i.status,
      resolution: i.resolution,
      resolutionNote: i.resolutionNote,
      raisedById: i.raisedById,
      raisedByRole: i.raisedByRole,
      resolvedById: i.resolvedById,
      createdAt: this.clock.toIso(i.createdAt),
      resolvedAt: iso(i.resolvedAt),
      photos: i.photoIds.map((id) => ({
        id,
        href: `${this.self(i)}/attachments/${id}`,
      })),
      _links: {},
    };
  }
}
