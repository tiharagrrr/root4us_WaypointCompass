import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, isNull } from 'drizzle-orm';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { notifications } from '../../../db/schema';
import { NOTIFICATION_RESOURCE } from '../notification.resource';
import { NotificationScope } from '../policies/notification.scope';

export type NotificationRow = typeof notifications.$inferSelect;

/** The bell's reads, always through NotificationScope (the caller's own in-app rows). */
@Injectable()
export class NotificationQueries {
  constructor(
    private readonly crud: CrudQueryService,
    private readonly scope: NotificationScope,
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  list(query: ListQuery, actor: Actor): Promise<Page<NotificationRow>> {
    return this.crud.list<NotificationRow>(
      NOTIFICATION_RESOURCE,
      query,
      this.scope.where(actor),
    );
  }

  get(id: string, actor: Actor): Promise<NotificationRow> {
    return this.crud.get<NotificationRow>(
      NOTIFICATION_RESOURCE,
      id,
      this.scope.where(actor),
    );
  }

  unread(actor: Actor): Promise<number> {
    return this.txHost.tx.$count(
      notifications,
      and(this.scope.where(actor), isNull(notifications.readAt)),
    );
  }
}
