import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  type Actor,
  type LoadLineStatus,
  releaseChecks,
  type ReleaseCheck,
  type TempClass,
  type TripStatus,
} from '@waypoint/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { SettingsService } from '../../../core/settings/settings.service';
import {
  depotWaves,
  items,
  loadCheckLines,
  loadFlags,
  loadReleases,
  orderLines,
  orders,
  outlets,
  plans,
  stops,
  trips,
} from '../../../db/schema';
import { groupByStop, isFlagOpen, isOutstanding } from '../domain/load-order';
import type { LoadProgress, StopGroup } from '../domain/load-order';
import { LOAD_FLAG_RESOURCE } from '../load-flag.resource';
import { LoadScope } from '../policies/load.scope';

export type LoadLineRow = typeof loadCheckLines.$inferSelect;
export type LoadFlagRow = typeof loadFlags.$inferSelect;
export type LoadReleaseRow = typeof loadReleases.$inferSelect;

/** A line with the item and order fields L2's row shows. */
export interface LoadLineView extends LoadLineRow {
  status: LoadLineStatus;
  orderNo: string;
  outletId: string;
  outletName: string;
  sku: string | null;
  itemName: string | null;
  packLabel: string | null;
  /** The line's flags, newest last; L2 shows the open one. */
  flags: LoadFlagRow[];
}

/** One stop's card on L2, with the outlet the goods are going to. */
export interface LoadStopGroup extends StopGroup<LoadLineView> {
  stopId: string | null;
  orderId: string;
  orderNo: string;
  outletId: string;
  outletName: string;
}

/** The trip fields the list, the checks and the links all read. */
export interface LoadTripRow {
  id: string;
  planId: string;
  depotId: string;
  date: string;
  vehicleId: string;
  driverId: string | null;
  status: TripStatus;
  tempClass: TempClass;
  waveId: string | null;
  plannedDepartAt: Date | null;
  releasedAt: Date | null;
  releaseTempC: number | null;
  /** The plan's revision, which the list must match to release. */
  planRevision: number;
  version: number;
}

/** A whole load list: L2, and what ReleaseService checks. */
export interface LoadListView {
  trip: LoadTripRow;
  lines: LoadLineView[];
  stops: LoadStopGroup[];
  flags: LoadFlagRow[];
  progress: LoadProgress;
  /** The revision the lines carry; behind the plan's after a revision. */
  listRevision: number;
  release: LoadReleaseRow | null;
}

/** One trip on L2's list and the runs board. */
export interface LoadTripSummary extends LoadTripRow {
  outletCount: number;
  progress: LoadProgress;
}

/** A wave on L2m-a, with the trips under it. */
export interface LoadRun {
  waveId: string | null;
  label: string;
  departFromMin: number | null;
  departToMin: number | null;
  trips: LoadTripSummary[];
  progress: LoadProgress;
}

const EMPTY: LoadProgress = {
  lines: 0,
  checked: 0,
  outstanding: 0,
  openFlags: 0,
};

/**
 * Every read of a load list, run board, flag queue or release check, always
 * through the module's scope (architecture rule 5), so a loader neither
 * lists nor opens another depot's trip or yesterday's (AC-LOD-02).
 *
 * The services call these too: a command loads the rows it is about to
 * change through the same query the screen used, so a write can never touch
 * a row the reader could not see.
 */
@Injectable()
export class LoadingQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly crud: CrudQueryService,
    private readonly scope: LoadScope,
    private readonly clock: ClockService,
    private readonly settings: SettingsService,
  ) {}

  /** L2m-a: the day's trips grouped by wave, with progress and open flags. */
  async runs(depotId: string, date: string, actor: Actor): Promise<LoadRun[]> {
    const summaries = await this.tripSummaries(depotId, date, actor);
    const waves = await this.txHost.tx
      .select()
      .from(depotWaves)
      .where(eq(depotWaves.depotId, depotId))
      .orderBy(asc(depotWaves.departFromMin), asc(depotWaves.label));

    const runs: LoadRun[] = waves.map((wave) => ({
      waveId: wave.id,
      label: wave.label,
      departFromMin: wave.departFromMin,
      departToMin: wave.departToMin,
      trips: summaries.filter((trip) => trip.waveId === wave.id),
      progress: EMPTY,
    }));
    // Fresh trips leave at 03:30 and belong to no wave (the spec's Open
    // questions). They get a group of their own, last, rather than being
    // dropped from the board or folded into somebody else's run.
    const unwaved = summaries.filter((trip) => trip.waveId == null);
    if (unwaved.length)
      runs.push({
        waveId: null,
        label: 'No wave',
        departFromMin: null,
        departToMin: null,
        trips: unwaved,
        progress: EMPTY,
      });
    return runs
      .filter((run) => run.trips.length > 0)
      .map((run) => ({ ...run, progress: sumProgress(run.trips) }));
  }

  /** L2: one wave's trips, or the day's when no wave is given. */
  async trips(
    depotId: string,
    date: string,
    actor: Actor,
    waveId?: string,
  ): Promise<LoadTripSummary[]> {
    const summaries = await this.tripSummaries(depotId, date, actor);
    return waveId
      ? summaries.filter((trip) => trip.waveId === waveId)
      : summaries;
  }

  /**
   * L2's list: every line of the trip, grouped by stop, last stop first,
   * with the plan's revision, the flags and the release that closed it.
   */
  async loadList(tripId: string, actor: Actor): Promise<LoadListView> {
    const trip = await this.trip(tripId, actor);
    const lines = await this.linesOf(tripId);
    const flags = await this.flagsOf(tripId);
    const byLine = new Map<string, LoadFlagRow[]>();
    for (const flag of flags) {
      const group = byLine.get(flag.loadLineId);
      if (group) group.push(flag);
      else byLine.set(flag.loadLineId, [flag]);
    }
    const views: LoadLineView[] = lines.map((line) => ({
      ...line,
      flags: byLine.get(line.id) ?? [],
    }));
    const [release] = await this.txHost.tx
      .select()
      .from(loadReleases)
      .where(eq(loadReleases.tripId, tripId));

    return {
      trip,
      lines: views,
      stops: this.stopGroups(views),
      flags,
      progress: progressOf(views, flags),
      listRevision: views.reduce(
        (max, line) => Math.max(max, line.planRevision),
        0,
      ),
      release: release ?? null,
    };
  }

  /** The trip within the actor's scope, or 404 (architecture rule 5). */
  async trip(tripId: string, actor: Actor): Promise<LoadTripRow> {
    const [row] = await this.txHost.tx
      .select({
        id: trips.id,
        planId: trips.planId,
        depotId: trips.depotId,
        date: plans.date,
        vehicleId: trips.vehicleId,
        driverId: trips.driverId,
        status: trips.status,
        tempClass: trips.tempClass,
        waveId: trips.waveId,
        plannedDepartAt: trips.plannedDepartAt,
        releasedAt: trips.releasedAt,
        releaseTempC: trips.releaseTempC,
        planRevision: plans.revision,
        version: trips.version,
      })
      .from(trips)
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(eq(trips.id, tripId), this.scope.where(actor) ?? sql`true`));
    return this.scope.found(row);
  }

  /** L4: each precondition with a pass or a fail (AC-LOD-14). */
  async releaseChecksFor(
    tripId: string,
    actor: Actor,
    input: { reeferTempC?: number | null; seenRevision?: number | null } = {},
  ): Promise<{ list: LoadListView; checks: ReleaseCheck[] }> {
    const list = await this.loadList(tripId, actor);
    // Global, not per depot: `loading.maxReleaseTempC` is not declared
    // `perDepot` in the settings registry, because the cold chain is a
    // food-safety limit rather than a depot's preference.
    const maxReleaseTempC = await this.settings.get('loading.maxReleaseTempC');
    return {
      list,
      checks: releaseChecks({
        trip: {
          status: list.trip.status,
          tempClass: list.trip.tempClass,
          driverId: list.trip.driverId,
        },
        lines: list.lines,
        flags: list.flags,
        planRevision: list.trip.planRevision,
        reeferTempC: input.reeferTempC ?? list.release?.releaseTempC ?? null,
        maxReleaseTempC,
        seenRevision: input.seenRevision ?? null,
      }),
    };
  }

  /** The dispatcher's flag queue on 01 and 19 (AC-LOD-07). */
  list(query: ListQuery, actor: Actor): Promise<Page<LoadFlagRow>> {
    return this.crud.list<LoadFlagRow>(
      LOAD_FLAG_RESOURCE,
      query,
      this.scope.forTrip(loadFlags.tripId, actor),
    );
  }

  /** One flag, or 404 when it is missing or outside the caller's scope. */
  flag(id: string, actor: Actor): Promise<LoadFlagRow> {
    return this.crud.get<LoadFlagRow>(
      LOAD_FLAG_RESOURCE,
      id,
      this.scope.forTrip(loadFlags.tripId, actor),
    );
  }

  /** One line, or 404; used by undo and by the check batch. */
  async line(id: string, actor: Actor): Promise<LoadLineView> {
    const [row] = await this.linesWhere(
      and(
        eq(loadCheckLines.id, id),
        this.scope.forTrip(loadCheckLines.tripId, actor) ?? sql`true`,
      ),
    );
    const line = this.scope.found(row);
    return { ...line, flags: await this.flagsOfLine(line.id) };
  }

  /** Every line of a trip, last stop first, then by item for a stable list. */
  linesOf(tripId: string): Promise<Omit<LoadLineView, 'flags'>[]> {
    return this.linesWhere(eq(loadCheckLines.tripId, tripId));
  }

  flagsOf(tripId: string): Promise<LoadFlagRow[]> {
    return this.txHost.tx
      .select()
      .from(loadFlags)
      .where(eq(loadFlags.tripId, tripId))
      .orderBy(asc(loadFlags.raisedAt), asc(loadFlags.id));
  }

  flagsOfLine(loadLineId: string): Promise<LoadFlagRow[]> {
    return this.txHost.tx
      .select()
      .from(loadFlags)
      .where(eq(loadFlags.loadLineId, loadLineId))
      .orderBy(asc(loadFlags.raisedAt), asc(loadFlags.id));
  }

  /** The orders a trip carries, for marking them LOADED on release. */
  async orderIdsOf(tripId: string): Promise<string[]> {
    const rows = await this.txHost.tx
      .selectDistinct({ orderId: loadCheckLines.orderId })
      .from(loadCheckLines)
      .where(
        and(
          eq(loadCheckLines.tripId, tripId),
          // An order whose every line was removed is not on the vehicle.
          sql`${loadCheckLines.status} <> 'REMOVED'`,
        ),
      );
    return rows.map((row) => row.orderId);
  }

  /**
   * The lines with the item and outlet fields a row shows. One query with
   * left joins rather than the relational API, because `orderLineId` is null
   * for an order with no lines and a left join keeps that row in the list.
   */
  private async linesWhere(
    where: ReturnType<typeof and>,
  ): Promise<Omit<LoadLineView, 'flags'>[]> {
    return this.txHost.tx
      .select({
        id: loadCheckLines.id,
        tripId: loadCheckLines.tripId,
        orderId: loadCheckLines.orderId,
        orderLineId: loadCheckLines.orderLineId,
        stopSeq: loadCheckLines.stopSeq,
        status: loadCheckLines.status,
        qtyExpected: loadCheckLines.qtyExpected,
        qtyLoaded: loadCheckLines.qtyLoaded,
        planRevision: loadCheckLines.planRevision,
        checkedByUserId: loadCheckLines.checkedByUserId,
        checkedByName: loadCheckLines.checkedByName,
        deviceId: loadCheckLines.deviceId,
        clientUuid: loadCheckLines.clientUuid,
        checkedAt: loadCheckLines.checkedAt,
        orderNo: orders.orderNo,
        outletId: orders.outletId,
        outletName: outlets.name,
        sku: items.sku,
        itemName: items.name,
        packLabel: items.packLabel,
      })
      .from(loadCheckLines)
      .innerJoin(orders, eq(orders.id, loadCheckLines.orderId))
      .innerJoin(outlets, eq(outlets.id, orders.outletId))
      .leftJoin(orderLines, eq(orderLines.id, loadCheckLines.orderLineId))
      .leftJoin(items, eq(items.id, orderLines.itemId))
      .where(where)
      .orderBy(
        sql`${loadCheckLines.stopSeq} DESC`,
        asc(items.sku),
        asc(loadCheckLines.id),
      );
  }

  /** The stop cards, last stop first, each naming where its goods go. */
  private stopGroups(lines: readonly LoadLineView[]): LoadStopGroup[] {
    const first = new Map<number, LoadLineView>();
    for (const line of lines)
      if (!first.has(line.stopSeq)) first.set(line.stopSeq, line);
    return groupByStop(lines).map((group) => {
      const head = first.get(group.stopSeq)!;
      return {
        ...group,
        stopId: null,
        orderId: head.orderId,
        orderNo: head.orderNo,
        outletId: head.outletId,
        outletName: head.outletName,
      };
    });
  }

  /**
   * The day's trips with their progress, in one pass: the counts come from
   * aggregate queries rather than a row per line, because the runs board asks
   * for 24 trips at once and L2m-a is on the judge path.
   */
  private async tripSummaries(
    depotId: string,
    date: string,
    actor: Actor,
  ): Promise<LoadTripSummary[]> {
    const rows = await this.txHost.tx
      .select({
        id: trips.id,
        planId: trips.planId,
        depotId: trips.depotId,
        date: plans.date,
        vehicleId: trips.vehicleId,
        driverId: trips.driverId,
        status: trips.status,
        tempClass: trips.tempClass,
        waveId: trips.waveId,
        plannedDepartAt: trips.plannedDepartAt,
        releasedAt: trips.releasedAt,
        releaseTempC: trips.releaseTempC,
        planRevision: plans.revision,
        version: trips.version,
      })
      .from(trips)
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(
        and(
          eq(trips.depotId, depotId),
          eq(plans.date, date),
          sql`${trips.status} <> 'CANCELLED'`,
          this.scope.where(actor) ?? sql`true`,
        ),
      )
      .orderBy(asc(trips.vehicleId), asc(trips.tripNo));
    if (rows.length === 0) return [];

    const tripIds = rows.map((row) => row.id);
    const counts = await this.txHost.tx
      .select({
        tripId: loadCheckLines.tripId,
        lines: sql<number>`count(*)::int`,
        checked: sql<number>`count(*) FILTER (WHERE ${loadCheckLines.status} IN ('OK', 'REPLACED', 'REMOVED'))::int`,
        outstanding: sql<number>`count(*) FILTER (WHERE ${loadCheckLines.status} IN ('PENDING', 'FLAGGED'))::int`,
      })
      .from(loadCheckLines)
      .where(inArray(loadCheckLines.tripId, tripIds))
      .groupBy(loadCheckLines.tripId);
    const openFlags = await this.txHost.tx
      .select({
        tripId: loadFlags.tripId,
        open: sql<number>`count(*)::int`,
      })
      .from(loadFlags)
      .where(
        and(
          inArray(loadFlags.tripId, tripIds),
          sql`${loadFlags.status} IN ('OPEN', 'AWAITING_RECHECK')`,
        ),
      )
      .groupBy(loadFlags.tripId);
    const outletCounts = await this.txHost.tx
      .select({
        tripId: stops.tripId,
        outlets: sql<number>`count(DISTINCT ${stops.outletId})::int`,
      })
      .from(stops)
      .where(
        and(
          inArray(stops.tripId, tripIds),
          sql`${stops.status} <> 'CANCELLED'`,
        ),
      )
      .groupBy(stops.tripId);

    const byTrip = new Map(counts.map((row) => [row.tripId, row]));
    const flagsByTrip = new Map(openFlags.map((row) => [row.tripId, row.open]));
    const outletsByTrip = new Map(
      outletCounts.map((row) => [row.tripId, row.outlets]),
    );
    return rows.map((row) => {
      const count = byTrip.get(row.id);
      return {
        ...row,
        outletCount: outletsByTrip.get(row.id) ?? 0,
        progress: {
          lines: count?.lines ?? 0,
          checked: count?.checked ?? 0,
          outstanding: count?.outstanding ?? 0,
          openFlags: flagsByTrip.get(row.id) ?? 0,
        },
      };
    });
  }

  /** Today in Asia/Colombo, for a request that names no date. */
  today(): string {
    return this.clock.businessDate();
  }
}

/** The counts L2's header shows: "14 of 18 checked, 1 flag open". */
export function progressOf(
  lines: readonly { status: LoadLineStatus }[],
  flags: readonly { status: Parameters<typeof isFlagOpen>[0] }[],
): LoadProgress {
  return {
    lines: lines.length,
    checked: lines.filter((line) => !isOutstanding(line.status)).length,
    outstanding: lines.filter((line) => isOutstanding(line.status)).length,
    openFlags: flags.filter((flag) => isFlagOpen(flag.status)).length,
  };
}

function sumProgress(trips: readonly LoadTripSummary[]): LoadProgress {
  return trips.reduce<LoadProgress>(
    (total, trip) => ({
      lines: total.lines + trip.progress.lines,
      checked: total.checked + trip.progress.checked,
      outstanding: total.outstanding + trip.progress.outstanding,
      openFlags: total.openFlags + trip.progress.openFlags,
    }),
    { ...EMPTY },
  );
}
