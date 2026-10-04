import { ISSUE_STATUSES, ISSUE_TYPES } from '@waypoint/shared';
import { ilike, or } from 'drizzle-orm';
import {
  contains,
  enumFilter,
  type ResourceSpec,
  textFilter,
  uuidFilter,
} from '../../core/persistence/resource-spec';
import { issues } from '../../db/schema';

/** The issue list a store or dispatcher works from, newest first. */
export const ISSUE_RESOURCE = {
  name: 'issues',
  singular: 'issue',
  table: issues,
  queryKey: 'issues',
  pagination: 'offset',
  defaultSort: '-createdAt',
  filters: {
    status: enumFilter(issues.status, ISSUE_STATUSES),
    type: enumFilter(issues.type, ISSUE_TYPES),
    outletId: textFilter(issues.outletId),
    orderId: uuidFilter(issues.orderId),
  },
  sorts: { createdAt: issues.createdAt, status: issues.status },
  search: (q) => or(ilike(issues.description, contains(q))),
} satisfies ResourceSpec<typeof issues>;
