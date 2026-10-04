import { Injectable } from '@nestjs/common';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { NotificationDto } from '../dto/notification.dto';
import type { NotificationRow } from '../services/notification.queries';

export const MY_NOTIFICATIONS = '/api/v1/me/notifications';

/** A bell line offers "mark read" until it is read; the rows are always the caller's own. */
@Injectable()
export class NotificationLinks extends LinkBuilder<
  NotificationRow,
  Omit<NotificationDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(row: NotificationRow) {
    return `${MY_NOTIFICATIONS}/${row.id}`;
  }

  protected actions(row: NotificationRow): LinkMap {
    return {
      read: !row.readAt && {
        href: `${this.self(row)}/read`,
        method: 'POST',
        title: 'Mark as read',
      },
    };
  }

  protected present(row: NotificationRow): Omit<NotificationDto, '_links'> {
    const link = (row.data as { link?: unknown } | null)?.link;
    return {
      id: row.id,
      eventType: row.eventType,
      title: row.title,
      body: row.body,
      link: typeof link === 'string' ? link : null,
      createdAt: this.clock.toIso(row.createdAt),
      readAt: row.readAt ? this.clock.toIso(row.readAt) : null,
    };
  }

  /** The badge, with "mark all read" while there is anything to mark. */
  summary(unread: number) {
    return {
      unread,
      _links: {
        self: { href: `${MY_NOTIFICATIONS}/summary` },
        list: { href: MY_NOTIFICATIONS },
        ...(unread > 0 && {
          readAll: {
            href: `${MY_NOTIFICATIONS}/read-all`,
            method: 'POST' as const,
            title: 'Mark all as read',
          },
        }),
      },
    };
  }
}
