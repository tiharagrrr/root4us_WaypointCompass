import { Injectable } from '@nestjs/common';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { NotificationDto } from '../dto/notification.dto';
import type { NotificationRow } from '../services/notification.queries';
import type {
  PreferenceRow,
  PreferenceSheet,
} from '../services/preferences.service';

export const MY_NOTIFICATIONS = '/api/v1/me/notifications';
export const MY_PREFERENCES = '/api/v1/me/notification-preferences';

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

  /** Every row offers `update`; email suppressed offers `resumeEmail`. */
  preferences(sheet: PreferenceSheet) {
    return {
      items: sheet.items.map((item) => this.preference(item)),
      emailSuppressed: sheet.emailSuppressed,
      _links: {
        self: { href: MY_PREFERENCES },
        ...(sheet.emailSuppressed && {
          resumeEmail: {
            href: `${MY_PREFERENCES}/resume-email`,
            method: 'POST' as const,
            title: 'Turn email back on',
          },
        }),
      },
    };
  }

  preference(item: PreferenceRow) {
    const href = `${MY_PREFERENCES}/${encodeURIComponent(item.eventType)}`;
    return {
      ...item,
      _links: {
        self: { href },
        update: { href, method: 'PUT' as const, title: 'Save' },
      },
    };
  }
}
