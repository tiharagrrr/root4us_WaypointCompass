import {
  textFilter,
  type ResourceSpec,
} from '../../core/persistence/resource-spec';
import { notifications } from '../../db/schema';

/**
 * The 02 bell: a feed, so cursor pages newest first (specs/notifications,
 * Endpoints: limit default 50, max 200). The scope keeps it to the caller's
 * own in-app rows.
 */
export const NOTIFICATION_RESOURCE = {
  name: 'notifications',
  singular: 'notification',
  table: notifications,
  queryKey: 'notifications',
  pagination: 'cursor',
  defaultSort: '-createdAt',
  filters: {
    eventType: textFilter(notifications.eventType),
  },
  sorts: {
    createdAt: notifications.createdAt,
  },
} satisfies ResourceSpec<typeof notifications>;
