import { addDays, cutoffFor, instantAt } from '@waypoint/shared';
import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  deferrals,
  deliveryLines,
  engineRuns,
  fuelLedgerEntries,
  issues,
  loadCheckLines,
  loadFlags,
  loadReleases,
  orders,
  planRevisions,
  plans,
  positionPings,
  receipts,
  settings,
  stopEvents,
  stops,
  syncConflicts,
  trips,
  vehicles,
} from '../schema';
import { adjustmentFor, catalogFor } from './catalog';
import type { DbLike } from './db-like';
import { insertLines, nextOrderNo } from './seed-orders';
import { linesFor } from './order-lines';
import { S1_SETTING, s1SnapshotSchema, type S1Snapshot } from './s1';

export interface RebuildResult {
  deleted: number;
  created: number;
}

/** `column IN (…)`, or no rows for an empty list. */
const within = (column: AnyPgColumn, ids: readonly string[]): SQL =>
  ids.length ? inArray(column, [...ids]) : sql`false`;

/** Orders a plan moved on from CONFIRMED; with that plan gone they wait in the queue again. */
const PLANNED_STATUSES = [
  'PLANNED',
  'DEFERRED',
  'LOADED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIAL',
  'FAILED',
] as const;

const DISPATCHER_NOTE =
  'Every suitable vehicle was full on the last run. Your order goes first on this one.';

/**
 * Rebuilds the demo day for every depot with a snapshot (AC-IDN-59), given D−1, D and D+1:
 *
 * 1. Clears those days' plans and everything hanging off their trips: stops, load checks and
 *    flags, stop events, receipts and issues at those stops, fuel entries, deferrals, revisions and
 *    engine runs. Audit rows and outbox events are never touched.
 * 2. Puts every demo-day order (S1 at Peliyagoda, kandy-day.ts at Kandy) back on D in its seeded
 *    state: CONFIRMED, or DEFERRED from D−1 with a confirmed deferral on a closed D−1 plan when its
 *    outlet was skipped on the run before.
 * 3. Sends any other order those plans had moved back to CONFIRMED, so it is in the queue again.
 * 4. Replaces Fresh Kadawatha's seeded draft with a fresh one for D+1, and restores the fleet.
 *
 * Rows outside D−1 to D+1 are left alone. The seed and POST /demo/reset both run this, so the
 * dataset files are read only by the seed.
 */
export async function rebuildDemoDay(
  db: DbLike,
  days: readonly string[],
  opts: { depots?: string[] } = {},
): Promise<RebuildResult> {
  const [yesterday, demoDay, tomorrow] = days;
  if (!yesterday || !demoDay || !tomorrow)
    throw new Error('rebuildDemoDay needs D−1, D and D+1');
  const snapshots = await db
    .select({ depotId: settings.scope, value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.key, S1_SETTING),
        opts.depots ? within(settings.scope, opts.depots) : undefined,
      ),
    );

  const total: RebuildResult = { deleted: 0, created: 0 };
  for (const row of snapshots) {
    const snapshot = s1SnapshotSchema.safeParse(row.value);
    if (!snapshot.success) continue;
    const deleted = await clearDays(db, row.depotId, days);
    const created = await restore(db, row.depotId, snapshot.data, {
      yesterday,
      demoDay,
      tomorrow,
    });
    total.deleted += deleted;
    total.created += created;
  }
  return total;
}

async function ids(query: Promise<{ id: string }[]>): Promise<string[]> {
  return (await query).map((r) => r.id);
}

/** Deletes the depot's plans for these days, children first. */
async function clearDays(
  db: DbLike,
  depotId: string,
  days: readonly string[],
): Promise<number> {
  const planIds = await ids(
    db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.depotId, depotId), within(plans.date, days))),
  );
  if (planIds.length === 0) return 0;
  const tripIds = await ids(
    db
      .select({ id: trips.id })
      .from(trips)
      .where(within(trips.planId, planIds)),
  );
  const stopIds = await ids(
    db
      .select({ id: stops.id })
      .from(stops)
      .where(within(stops.tripId, tripIds)),
  );
  const receiptIds = await ids(
    db
      .select({ id: receipts.id })
      .from(receipts)
      .where(within(receipts.stopId, stopIds)),
  );
  const eventIds = await ids(
    db
      .select({ id: stopEvents.id })
      .from(stopEvents)
      .where(within(stopEvents.tripId, tripIds)),
  );

  let deleted = 0;
  const gone = async (query: Promise<unknown[]>) => {
    deleted += (await query).length;
  };
  const id = { id: sql<string>`1` };
  await gone(
    db
      .delete(syncConflicts)
      .where(within(syncConflicts.stopEventId, eventIds))
      .returning(id),
  );
  await gone(
    db
      .delete(issues)
      .where(
        or(
          within(issues.stopId, stopIds),
          within(issues.receiptId, receiptIds),
        ),
      )
      .returning(id),
  );
  await gone(
    db.delete(receipts).where(within(receipts.id, receiptIds)).returning(id),
  );
  await gone(
    db
      .delete(deliveryLines)
      .where(within(deliveryLines.stopId, stopIds))
      .returning(id),
  );
  await gone(
    db.delete(stopEvents).where(within(stopEvents.id, eventIds)).returning(id),
  );
  await gone(
    db
      .delete(positionPings)
      .where(within(positionPings.tripId, tripIds))
      .returning(id),
  );
  await gone(
    db.delete(loadFlags).where(within(loadFlags.tripId, tripIds)).returning(id),
  );
  await gone(
    db
      .delete(loadReleases)
      .where(within(loadReleases.tripId, tripIds))
      .returning(id),
  );
  await gone(
    db
      .delete(loadCheckLines)
      .where(within(loadCheckLines.tripId, tripIds))
      .returning(id),
  );
  await gone(
    db
      .delete(fuelLedgerEntries)
      .where(within(fuelLedgerEntries.tripId, tripIds))
      .returning(id),
  );
  await db
    .update(orders)
    .set({ activeStopId: null })
    .where(within(orders.activeStopId, stopIds));
  await gone(
    db.delete(deferrals).where(within(deferrals.planId, planIds)).returning(id),
  );
  await gone(
    db
      .delete(planRevisions)
      .where(within(planRevisions.planId, planIds))
      .returning(id),
  );
  await gone(
    db
      .delete(engineRuns)
      .where(within(engineRuns.planId, planIds))
      .returning(id),
  );
  await gone(db.delete(stops).where(within(stops.id, stopIds)).returning(id));
  await gone(db.delete(trips).where(within(trips.id, tripIds)).returning(id));
  await gone(db.delete(plans).where(within(plans.id, planIds)).returning(id));
  return deleted;
}

async function restore(
  db: DbLike,
  depotId: string,
  snapshot: S1Snapshot,
  d: { yesterday: string; demoDay: string; tomorrow: string },
): Promise<number> {
  let created = 0;

  // Orders other than the demo day's that the cleared plans had moved on: back in the queue.
  await db
    .update(orders)
    .set({ status: 'CONFIRMED', activeStopId: null })
    .where(
      and(
        eq(orders.depotId, depotId),
        within(orders.deliveryDate, [d.yesterday, d.demoDay, d.tomorrow]),
        within(orders.status, PLANNED_STATUSES),
        snapshot.orders.length
          ? or(
              isNull(orders.externalRef),
              notInArray(orders.externalRef, snapshot.orders),
            )
          : undefined,
      ),
    );

  // Every demo-day order on D, in its seeded state.
  const skipped = new Set(snapshot.deferredYesterday);
  const s1 = await db
    .select({ id: orders.id, ref: orders.externalRef })
    .from(orders)
    .where(
      and(
        eq(orders.depotId, depotId),
        within(orders.externalRef, snapshot.orders),
      ),
    );
  const fresh = {
    deliveryDate: d.demoDay,
    activeStopId: null,
    urgent: false,
    afterCutoff: false,
    cancelledAt: null,
    cancelReason: null,
  };
  const wasSkipped = s1
    .filter((o) => o.ref && skipped.has(o.ref))
    .map((o) => o.id);
  const onTime = s1
    .filter((o) => !(o.ref && skipped.has(o.ref)))
    .map((o) => o.id);
  await db
    .update(orders)
    .set({
      ...fresh,
      status: 'CONFIRMED',
      requestedDate: d.demoDay,
      deferredCount: 0,
      lastDeferredAt: null,
      submittedAt: instantAt(d.yesterday, 600),
      confirmedAt: cutoffFor(d.yesterday, 960),
    })
    .where(within(orders.id, onTime));
  await db
    .update(orders)
    .set({
      ...fresh,
      status: 'DEFERRED',
      requestedDate: d.yesterday,
      deferredCount: 1,
      lastDeferredAt: instantAt(d.yesterday, 1200),
      submittedAt: instantAt(addDays(d.yesterday, -1), 600),
      confirmedAt: cutoffFor(addDays(d.yesterday, -1), 960),
    })
    .where(within(orders.id, wasSkipped));
  created += s1.length;

  // The run before D: closed, with the deferral the store was told about.
  if (wasSkipped.length) {
    const [plan] = await db
      .insert(plans)
      .values({
        depotId,
        date: d.yesterday,
        status: 'CLOSED',
        revision: 1,
        publishedAt: instantAt(addDays(d.yesterday, -1), 990),
        closedAt: instantAt(d.yesterday, 1200),
      })
      .returning({ id: plans.id });
    await db.insert(deferrals).values(
      wasSkipped.map((orderId) => ({
        orderId,
        planId: plan.id,
        status: 'CONFIRMED' as const,
        source: 'PLANNING' as const,
        reasonCode: 'OVER_CAPACITY',
        note: DISPATCHER_NOTE,
        fromDate: d.yesterday,
        toDate: d.demoDay,
        decidedAt: instantAt(addDays(d.yesterday, -1), 980),
      })),
    );
    created += 1 + wasSkipped.length;
  }

  // Fresh Kadawatha's dry order for D+1, still a draft. The one from the last build goes first,
  // whether the walkthrough sent it or not, as long as no plan has it.
  if (snapshot.draftOutletId) {
    await db
      .delete(orders)
      .where(
        and(
          eq(orders.outletId, snapshot.draftOutletId),
          eq(orders.source, 'seed'),
          isNull(orders.externalRef),
          within(orders.status, [
            'DRAFT',
            'SUBMITTED',
            'CONFIRMED',
            'CANCELLED',
          ]),
          isNull(orders.activeStopId),
        ),
      );
    created += await insertDraft(db, snapshot.draftOutletId, d.tomorrow);
  }

  // The S1 fleet: the workshop vehicles out, the rest in service.
  await db
    .update(vehicles)
    .set({ status: 'WORKSHOP', statusReason: 'In the workshop (scenario S1)' })
    .where(within(vehicles.id, snapshot.workshop));
  await db
    .update(vehicles)
    .set({ status: 'ACTIVE', statusReason: null })
    .where(
      and(
        within(vehicles.id, snapshot.available),
        ne(vehicles.status, 'ACTIVE'),
      ),
    );
  return created;
}

const DRAFT_TOTALS = { weightKg: 180, volumeM3: 0.6 };

async function insertDraft(
  db: DbLike,
  outletId: string,
  date: string,
): Promise<number> {
  const [outlet] = await db
    .execute<{ id: string; depotId: string; districtId: string }>(
      sql`SELECT id, "depotId", "districtId" FROM outlets WHERE id = ${outletId}`,
    )
    .then((r) => r.rows);
  if (!outlet) return 0;
  const lines = linesFor(
    `draft-${outletId}`,
    DRAFT_TOTALS,
    catalogFor('FRESH', 'AMBIENT'),
    adjustmentFor('FRESH', 'AMBIENT'),
  ).slice(0, -1);
  const weightKg = lines.reduce((n, l) => n + l.qty * l.unitWeightKg, 0);
  const volumeM3 = lines.reduce((n, l) => n + l.qty * l.unitVolumeM3, 0);
  const [row] = await db
    .insert(orders)
    .values({
      orderNo: await nextOrderNo(db, 'FRESH'),
      outletId,
      depotId: outlet.depotId,
      brand: 'FRESH',
      districtId: outlet.districtId,
      tempClass: 'AMBIENT',
      requestedDate: date,
      deliveryDate: date,
      status: 'DRAFT',
      units: lines.reduce((n, l) => n + l.qty, 0),
      weightKg,
      volumeM3,
      source: 'seed',
    })
    .returning({ id: orders.id });
  await insertLines(db, [{ orderId: row.id, lines }]);
  return 1;
}
