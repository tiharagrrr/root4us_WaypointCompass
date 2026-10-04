import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { can, type Actor } from '@waypoint/shared';
import { and, asc, inArray, type SQL, sql } from 'drizzle-orm';
import { ForbiddenError } from '../../../core/errors/domain-errors';
import { PAGE_LIMITS } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { outboxEvents, trips } from '../../../db/schema';
import {
  decodeSince,
  encodeSince,
  type ChangesPosition,
} from '../domain/changes-cursor';
import { CHANGE_TYPES } from '../sync.constants';
import { ChangesScope } from '../policies/changes.scope';

/** One server-side change a device has not seen yet. */
export interface SyncChange {
  id: string;
  type: string;
  occurredAt: Date;
  /** The device's trip the change is about; the first one for a plan revision that touches several. */
  tripId: string | null;
  /** The event's own payload (`v: 1`), as the relay delivers it. */
  data: Record<string, unknown>;
}

export interface ChangesPage {
  items: SyncChange[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
}

const occurredMs = sql`date_trunc('milliseconds', ${outboxEvents.occurredAt})`;

/**
 * `GET /sync/changes` (specs/sync/spec.md): the outbox rows that matter to a field device, for its
 * own trips only, oldest first. A change belongs to a trip when the event names it in `tripId`, or
 * in `tripIds` for a plan revision; the trip must be inside `ChangesScope`, which is what keeps
 * another driver's trip out of the feed (AC-SYN-12).
 *
 * `since` is a cursor this feed issued (time to the millisecond plus id), so two changes in the same
 * millisecond are never skipped or repeated. `nextCursor` is the position of the last change on the
 * page, whether or not more follow, so a device that has caught up keeps a place to resume from;
 * it is null only when nothing is newer than `since`.
 */
@Injectable()
export class ChangesFeed {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: ChangesScope,
  ) {}

  async list(
    actor: Actor,
    query: { since?: string; limit?: number },
  ): Promise<ChangesPage> {
    if (!can(actor, 'stop:record') && !can(actor, 'load:check'))
      throw new ForbiddenError('Only drivers and loaders pull changes.');

    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(query.limit ?? PAGE_LIMITS.cursor.default),
        PAGE_LIMITS.cursor.max,
      ),
    );
    const after: ChangesPosition | undefined = query.since
      ? decodeSince(query.since)
      : undefined;

    const mine = this.scope.where(actor);
    const conditions: (SQL | undefined)[] = [
      inArray(outboxEvents.type, [...CHANGE_TYPES]),
      sql`EXISTS (SELECT 1 FROM ${trips} WHERE ${mine} AND (${trips.id}::text = ${outboxEvents.payload}->>'tripId' OR ${outboxEvents.payload}->'tripIds' @> to_jsonb(${trips.id}::text)))`,
      after
        ? sql`(${occurredMs}, ${outboxEvents.id}) > (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`
        : undefined,
    ];

    const rows = await this.txHost.tx
      .select()
      .from(outboxEvents)
      .where(and(...conditions))
      .orderBy(asc(occurredMs), asc(outboxEvents.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row): SyncChange => {
      const data = row.payload as Record<string, unknown>;
      const ids = Array.isArray(data.tripIds) ? data.tripIds : [];
      const tripId =
        typeof data.tripId === 'string'
          ? data.tripId
          : typeof ids[0] === 'string'
            ? ids[0]
            : null;
      return {
        id: row.id,
        type: row.type,
        occurredAt: row.occurredAt,
        tripId,
        data,
      };
    });
    const last = items.at(-1);
    return {
      items,
      page: {
        limit,
        hasMore,
        nextCursor: last
          ? encodeSince({
              at: new Date(Math.trunc(last.occurredAt.getTime())),
              id: last.id,
            })
          : null,
      },
    };
  }
}
