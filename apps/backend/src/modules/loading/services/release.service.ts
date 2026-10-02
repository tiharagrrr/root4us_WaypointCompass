import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { type Actor, canRelease, type ReleaseCheck } from '@waypoint/shared';
import { asc, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { RequestContext } from '../../../core/context/request-context';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { EventPayload } from '../../../core/persistence/ports';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { loadReleases, stops } from '../../../db/schema';
import { type AuditSource, AuditService } from '../../audit';
import { OrderLifecycleService } from '../../ordering';
import { TripLifecycleService } from '../../planning';
import { ReleaseBlockedError } from '../domain/errors';
import { LOAD_AUDIT, LOAD_EVENTS, LOAD_LOGS } from '../loading.constants';
import type { TripReleasedEvent } from '../events/loading.events';
import {
  type LoadListView,
  type LoadReleaseRow,
  LoadingQueries,
} from './loading.queries';

export interface ReleaseInput {
  /** Required on a chilled or frozen trip (AC-LOD-15). */
  reeferTempC?: number | null;
  /** The name typed on the shared tablet. */
  checkedByName: string;
  clientUuid: string;
  /**
   * The revision the tablet believes the list is at. Optional, and when it is
   * given and it is stale the revision check fails — which is how release
   * confirms the tablet saw the latest plan (specs/loading/spec.md, Open
   * questions).
   */
  planRevision?: number | null;
  source?: AuditSource;
}

export interface Released {
  list: LoadListView;
  checks: ReleaseCheck[];
  release: LoadReleaseRow;
  /** True when this clientUuid had already released the trip: a replay. */
  duplicate: boolean;
}

/**
 * L4: the trip leaves the dock (AC-LOD-14 to AC-LOD-17).
 *
 * Release is the one loader action that needs a connection, because it is the
 * one that has to be sure: the list must match the plan the dispatcher
 * published, and only the server knows whether the plan moved while the
 * tablet was away. So there is no outbox path here and no offline fallback —
 * L4 shows its needs-a-connection state instead (AC-LOD-17).
 *
 * The preconditions are `releaseChecks()` in packages/shared, the same pure
 * function the tablet calls, so `GET /trips/{id}/release-checks`, the 409 and
 * the greyed-out button on L4 can never disagree (AC-LOD-14).
 *
 * What one release does, in one transaction: the `load_releases` row that
 * records who released it and against which revision, the trip's move to
 * RELEASED through planning, every order on it to LOADED through ordering,
 * one audit row and one `trip.released` event.
 */
@Injectable()
export class ReleaseService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly queries: LoadingQueries,
    private readonly lifecycle: TripLifecycleService,
    private readonly orders: OrderLifecycleService,
    private readonly clock: ClockService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(ReleaseService.name);
  }

  @Transactional()
  async release(
    tripId: string,
    input: ReleaseInput,
    actor: Actor,
  ): Promise<Released> {
    const replay = await this.replayOf(input.clientUuid);
    if (replay) {
      // The same tap twice: the tablet sent it, lost the answer and sent it
      // again. Nothing is written and nothing is audited, and the caller
      // gets the trip as the first release left it (AC-LOD-16).
      const list = await this.queries.loadList(replay.tripId, actor);
      const { checks } = await this.queries.releaseChecksFor(
        replay.tripId,
        actor,
      );
      return { list, checks, release: replay, duplicate: true };
    }

    const { list, checks } = await this.queries.releaseChecksFor(
      tripId,
      actor,
      {
        reeferTempC: input.reeferTempC ?? null,
        seenRevision: input.planRevision ?? null,
      },
    );
    if (!canRelease(checks)) throw new ReleaseBlockedError(checks);

    const at = this.clock.now();
    const [release] = await this.txHost.tx
      .insert(loadReleases)
      .values({
        tripId,
        checkedByName: input.checkedByName,
        releasedById: actor.id,
        deviceId: this.context.deviceId ?? actor.deviceId ?? null,
        releaseTempC: input.reeferTempC ?? null,
        planRevision: list.trip.planRevision,
        clientUuid: input.clientUuid,
        releasedAt: at,
      })
      .returning();

    const trip = await this.lifecycle.markReleased(tripId, {
      at,
      releasedById: actor.id,
      reeferTempC: input.reeferTempC ?? null,
    });
    // The whole load is on the vehicle (AC-LOD-16). An order every line of
    // which was removed is not, so it keeps its status and waits for its
    // backorder.
    //
    // An order already LOADED is left alone: a trip released, reassigned to
    // another vehicle and released again is one load on two vehicles, and
    // `orderMachine` has no LOAD from LOADED. Asking for the move anyway
    // would make the second release of AC-LOD-19 a 409 about an order the
    // dock did nothing wrong with.
    const orderIds = await this.queries.orderIdsOf(tripId);
    const statuses = await this.orders.statusesOf(orderIds);
    for (const orderId of orderIds)
      if (statuses.get(orderId) !== 'LOADED')
        await this.orders.markLoaded(orderId);

    await this.audit.record({
      action: LOAD_AUDIT.tripReleased,
      entity: ['trip', tripId],
      before: { status: list.trip.status },
      after: {
        status: trip.status,
        releasedAt: this.clock.toIso(at),
        releaseTempC: release.releaseTempC,
        planRevision: release.planRevision,
        lines: list.progress.lines,
        orders: orderIds.length,
      },
      actorName: input.checkedByName,
      occurredAt: at,
      clientUuid: input.clientUuid,
      ...(input.source && { source: input.source }),
    });
    await this.emit(list, release, orderIds);

    this.log.info(
      {
        event: LOAD_LOGS.tripReleased,
        tripId,
        depotId: list.trip.depotId,
        releaseTempC: release.releaseTempC,
        // How long the dock took, first check to release, which is the
        // number the spec asks the log line for.
        loadingMinutes: this.minutesLoading(list, at),
        lines: list.progress.lines,
      },
      'trip released',
    );

    const after = await this.queries.loadList(tripId, actor);
    return {
      list: after,
      checks: (await this.queries.releaseChecksFor(tripId, actor)).checks,
      release,
      duplicate: false,
    };
  }

  /** Minutes from the first check on the trip to the release. */
  private minutesLoading(list: LoadListView, at: Date): number | null {
    const first = list.lines
      .map((line) => line.checkedAt)
      .filter((checkedAt): checkedAt is Date => checkedAt != null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return first ? Math.round((at.getTime() - first.getTime()) / 60_000) : null;
  }

  private async replayOf(clientUuid: string): Promise<LoadReleaseRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(loadReleases)
      .where(eq(loadReleases.clientUuid, clientUuid));
    return row ?? null;
  }

  private async emit(
    list: LoadListView,
    release: LoadReleaseRow,
    orderIds: readonly string[],
  ): Promise<void> {
    const [first] = await this.txHost.tx
      .select({
        plannedArrivalAt: stops.plannedArrivalAt,
        outletId: stops.outletId,
      })
      .from(stops)
      .where(eq(stops.tripId, list.trip.id))
      .orderBy(asc(stops.seq))
      .limit(1);
    const payload: TripReleasedEvent = {
      v: 1,
      tripId: list.trip.id,
      planId: list.trip.planId,
      depotId: list.trip.depotId,
      vehicleId: list.trip.vehicleId,
      driverId: list.trip.driverId,
      stops: list.stops.length,
      orderIds: [...orderIds],
      releaseTempC: release.releaseTempC,
      releasedAt: this.clock.toIso(release.releasedAt),
      firstStopAt: first?.plannedArrivalAt
        ? this.clock.toIso(first.plannedArrivalAt)
        : null,
    };
    await this.outbox.add(
      LOAD_EVENTS.tripReleased,
      payload as unknown as EventPayload,
      {
        aggregate: ['trip', list.trip.id],
        depotId: list.trip.depotId,
        outletIds: list.stops.map((stop) => stop.outletId),
      },
    );
  }
}
