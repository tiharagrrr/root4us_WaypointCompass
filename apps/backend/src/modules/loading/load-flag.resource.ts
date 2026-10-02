import {
  LOAD_FLAG_DECISIONS,
  LOAD_FLAG_REASONS,
  LOAD_FLAG_STATUSES,
} from '@waypoint/shared';
import { ilike, or } from 'drizzle-orm';
import {
  contains,
  enumFilter,
  type ResourceSpec,
  uuidFilter,
} from '../../core/persistence/resource-spec';
import { loadFlags } from '../../db/schema';

/**
 * Flags as a listable resource: the dispatcher's queue on 01 and 19
 * (`GET /load-flags?filter[status]=OPEN`), with the whitelists
 * specs/api-conventions.md section 4 asks for.
 *
 * `defaultSort` is `status,raisedAt`: `load_flag_status` is declared OPEN,
 * AWAITING_RECHECK, RESOLVED and a Postgres enum sorts in declaration order,
 * so the flags nobody has answered come first, then the ones waiting on a
 * loader's re-check, then the day's closed ones — and inside each, oldest
 * first, because a loader standing at a crate has been waiting longest.
 *
 * There is no `depotId` filter and no depot column to put one on: a flag
 * belongs to a trip, and the scope reaches the depot through it, so the
 * queue is already one depot's unless the dispatcher is scoped to none.
 */
export const LOAD_FLAG_RESOURCE = {
  name: 'load-flags',
  singular: 'load flag',
  table: loadFlags,
  queryKey: 'loadFlags',
  pagination: 'offset',
  defaultSort: 'status,raisedAt',
  filters: {
    status: enumFilter(loadFlags.status, LOAD_FLAG_STATUSES),
    reason: enumFilter(loadFlags.reason, LOAD_FLAG_REASONS),
    decision: enumFilter(loadFlags.decision, LOAD_FLAG_DECISIONS),
    tripId: uuidFilter(loadFlags.tripId),
    loadLineId: uuidFilter(loadFlags.loadLineId),
  },
  sorts: {
    status: loadFlags.status,
    raisedAt: loadFlags.raisedAt,
    reason: loadFlags.reason,
    resolvedAt: loadFlags.resolvedAt,
  },
  /** The panel searches the loader's note and the name they typed. */
  search: (q) =>
    or(
      ilike(loadFlags.note, contains(q)),
      ilike(loadFlags.raisedByName, contains(q)),
    ),
} satisfies ResourceSpec<typeof loadFlags>;
