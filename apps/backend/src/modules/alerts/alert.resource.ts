import { ALERT_STATUSES, ALERT_TYPES } from '@waypoint/shared';
import { ilike } from 'drizzle-orm';
import {
  contains,
  enumFilter,
  numberFilter,
  type ResourceSpec,
  textFilter,
  uuidFilter,
} from '../../core/persistence/resource-spec';
import { alerts } from '../../db/schema';

/**
 * Alerts as a listable resource: the whitelists specs/api-conventions.md
 * section 4 asks for, which are also what 01's exception panel and 19's
 * alerts column query by.
 *
 * `defaultSort` is the spec's "open first, then severity" and needs no rank
 * expression to say it: `alert_status` is declared OPEN, ACKNOWLEDGED,
 * RESOLVED, and a Postgres enum sorts in declaration order, so sorting on the
 * column puts the work that needs doing at the top and the day's closed
 * alerts underneath. Severity 1 then comes before 2, and the id tiebreaker
 * (UUIDv7, so creation order) leaves the oldest alert of equal severity
 * first, the way a queue should read (AC-ALR-09).
 *
 * `outletId` is deliberately absent. 01 and 19 filter by depot, which is the
 * scope, and by trip; an outlet filter would invite a store-shaped query onto
 * a dispatcher-only resource, so asking for one is a 400 that names it.
 */
export const ALERT_RESOURCE = {
  name: 'alerts',
  singular: 'alert',
  table: alerts,
  queryKey: 'alerts',
  pagination: 'offset',
  defaultSort: 'status,severity',
  filters: {
    type: enumFilter(alerts.type, ALERT_TYPES),
    status: enumFilter(alerts.status, ALERT_STATUSES),
    severity: numberFilter(alerts.severity),
    tripId: uuidFilter(alerts.tripId),
    stopId: uuidFilter(alerts.stopId),
    /**
     * 01 is one depot's dashboard, and a dispatcher scoped to no depot sees
     * every depot, so without this filter their exception panel would mix
     * Kandy's alerts into Peliyagoda's day. The scope still applies on top:
     * asking for a depot outside it returns an empty page, never a peek.
     */
    depotId: textFilter(alerts.depotId),
  },
  sorts: {
    status: alerts.status,
    severity: alerts.severity,
    raisedAt: alerts.raisedAt,
    type: alerts.type,
  },
  /** 01's panel searches the titles it is showing. */
  search: (q) => ilike(alerts.title, contains(q)),
} satisfies ResourceSpec<typeof alerts>;
