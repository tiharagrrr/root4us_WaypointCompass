import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { ScopePolicy } from '../../../core/auth/scope-policy';
import { notifications } from '../../../db/schema';

/**
 * Everyone, admins included, reads only their own in-app notifications
 * (AC-NTF-13); another person's row is a 404 like a missing one. Email, SMS
 * and push rows are delivery records, not the bell's.
 */
@Injectable()
export class NotificationScope extends ScopePolicy {
  protected readonly resource = 'notification';

  where(actor: Actor): SQL | undefined {
    return and(
      eq(notifications.userId, actor.id),
      eq(notifications.channel, 'IN_APP'),
      isNull(notifications.archivedAt),
    );
  }
}
