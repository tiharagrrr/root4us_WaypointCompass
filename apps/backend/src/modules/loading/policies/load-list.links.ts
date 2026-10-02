import { Injectable } from '@nestjs/common';
import {
  type Actor,
  can,
  canRelease,
  type ReleaseCheck,
  tripMachine,
} from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { compact, type LinkMap, type Resource } from '../../../core/http/links';
import type {
  LoadLineDto,
  LoadListDto,
  LoadRunDto,
  LoadStopDto,
  LoadTripDto,
  LoadTripSummaryDto,
  ReleaseChecksDto,
} from '../dto/load-list.dto';
import type {
  LoadLineView,
  LoadListView,
  LoadRun,
  LoadTripRow,
  LoadTripSummary,
} from '../services/loading.queries';
import { LoadFlagLinks } from './load-flag.links';

/**
 * The load list, the run board and the release checks as the dock sees them,
 * with the actions allowed right now (specs/api-conventions.md, section 2).
 *
 * A line's own gates:
 *
 * - **check** while the line is PENDING and the trip is still at the dock. A
 *   checked line loses it and gains **undo** instead, which is what AC-LOD-01
 *   and AC-LOD-04 read back, and a released trip's lines carry neither
 *   (AC-LOD-06).
 * - **flag** while the goods are still the loader's problem: PENDING, or OK
 *   for damage spotted after the tick. A line that is FLAGGED, REPLACED or
 *   REMOVED has been dealt with, and the flag itself carries what is left to
 *   do.
 * - **undo** only for `load:check`, so a dispatcher reading the same list is
 *   offered nothing to press (AC-LOD-02).
 *
 * The trip's **release** link follows the trip machine: present while the
 * trip is LOADING and the viewer holds `load:release`, gone once it is
 * RELEASED (AC-LOD-16). It is deliberately *not* gated on the release checks
 * passing: the checks are the preconditions the action reports on, and L4
 * exists to show a loader what is still outstanding. `releaseChecks` on the
 * same resource is how the screen knows whether to enable the button, and the
 * server refuses with the same list if anyone presses it anyway (AC-LOD-14).
 */
@Injectable()
export class LoadListLinks {
  constructor(
    private readonly clock: ClockService,
    private readonly flags: LoadFlagLinks,
  ) {}

  /** GET /trips/{id}/load-list. */
  list(
    view: LoadListView,
    actor: Actor,
    checks: readonly ReleaseCheck[],
  ): Resource<LoadListDto> {
    const trip = view.trip;
    return {
      trip: this.trip(trip),
      stops: view.stops.map<LoadStopDto>((group) => ({
        stopSeq: group.stopSeq,
        orderId: group.orderId,
        orderNo: group.orderNo,
        outletId: group.outletId,
        outletName: group.outletName,
        outstanding: group.outstanding,
        lines: group.lines.map((line) => this.line(line, trip, actor)),
      })),
      progress: view.progress,
      listRevision: view.listRevision,
      upToDate:
        view.listRevision === trip.planRevision || view.progress.lines === 0,
      releasedByName: view.release?.checkedByName ?? null,
      releaseChecks: [...checks],
      _links: compact({
        self: { href: `/api/v1/trips/${trip.id}/load-list` },
        trip: { href: `/api/v1/trips/${trip.id}` },
        releaseChecks: { href: `/api/v1/trips/${trip.id}/release-checks` },
        checks: can(actor, 'load:check') &&
          this.atDock(trip) && {
            href: `/api/v1/trips/${trip.id}/load-list/checks`,
            method: 'POST',
            title: 'Check lines',
            requires: ['checks'],
          },
        flag: can(actor, 'load:flag') &&
          this.atDock(trip) && {
            href: `/api/v1/trips/${trip.id}/load-flags`,
            method: 'POST',
            title: 'Flag an item',
            requires: [
              'loadLineId',
              'reason',
              'qtyAffected',
              'raisedByName',
              'clientUuid',
            ],
          },
        ...this.release(trip, actor),
      }),
    };
  }

  /** GET /trips/{id}/release-checks: L4's checklist. */
  checks(
    view: LoadListView,
    actor: Actor,
    checks: readonly ReleaseCheck[],
    maxReleaseTempC: number,
  ): Resource<ReleaseChecksDto> {
    return {
      tripId: view.trip.id,
      canRelease: canRelease(checks),
      checks: [...checks],
      maxReleaseTempC,
      planRevision: view.trip.planRevision,
      _links: compact({
        self: { href: `/api/v1/trips/${view.trip.id}/release-checks` },
        loadList: { href: `/api/v1/trips/${view.trip.id}/load-list` },
        ...this.release(view.trip, actor),
      }),
    };
  }

  /** L2's trip list and L2m-a's cards. */
  summary(trip: LoadTripSummary, actor: Actor): Resource<LoadTripSummaryDto> {
    return {
      ...this.trip(trip),
      outletCount: trip.outletCount,
      progress: trip.progress,
      _links: compact({
        self: { href: `/api/v1/trips/${trip.id}/load-list` },
        trip: { href: `/api/v1/trips/${trip.id}` },
        releaseChecks: { href: `/api/v1/trips/${trip.id}/release-checks` },
        ...this.release(trip, actor),
      }),
    };
  }

  /** L2m-a: the waves, each with its trips. */
  runs(runs: readonly LoadRun[], actor: Actor): LoadRunDto[] {
    return runs.map((run) => ({
      waveId: run.waveId,
      label: run.label,
      departFromMin: run.departFromMin,
      departToMin: run.departToMin,
      progress: run.progress,
      trips: run.trips.map((trip) => this.summary(trip, actor)),
    }));
  }

  /** One line, for the response to a check, an undo or a flag. */
  line(line: LoadLineView, trip: LoadTripRow, actor: Actor): LoadLineDto {
    const atDock = this.atDock(trip);
    const checker = can(actor, 'load:check');
    return {
      id: line.id,
      tripId: line.tripId,
      orderId: line.orderId,
      orderLineId: line.orderLineId,
      stopSeq: line.stopSeq,
      status: line.status,
      qtyExpected: line.qtyExpected,
      qtyLoaded: line.qtyLoaded,
      planRevision: line.planRevision,
      orderNo: line.orderNo,
      outletId: line.outletId,
      outletName: line.outletName,
      sku: line.sku,
      itemName: line.itemName,
      packLabel: line.packLabel,
      checkedByName: line.checkedByName,
      checkedByUserId: line.checkedByUserId,
      checkedAt: line.checkedAt ? this.clock.toIso(line.checkedAt) : null,
      flags: line.flags.map((flag) => this.flags.one(flag, actor)),
      _links: compact({
        self: { href: `/api/v1/load-lines/${line.id}` },
        order: { href: `/api/v1/orders/${line.orderId}` },
        check: checker &&
          atDock &&
          line.status === 'PENDING' && {
            href: `/api/v1/trips/${line.tripId}/load-list/checks`,
            method: 'POST',
            title: 'Check this line',
            requires: ['checks'],
          },
        flag: can(actor, 'load:flag') &&
          atDock &&
          (line.status === 'PENDING' || line.status === 'OK') && {
            href: `/api/v1/trips/${line.tripId}/load-flags`,
            method: 'POST',
            title: 'Flag this item',
            requires: [
              'loadLineId',
              'reason',
              'qtyAffected',
              'raisedByName',
              'clientUuid',
            ],
          },
        undo: checker &&
          atDock &&
          line.status === 'OK' && {
            href: `/api/v1/load-lines/${line.id}/undo`,
            method: 'POST',
            title: 'Undo the check',
          },
      }),
    };
  }

  private trip(trip: LoadTripRow): LoadTripDto {
    return {
      id: trip.id,
      planId: trip.planId,
      depotId: trip.depotId,
      date: trip.date,
      vehicleId: trip.vehicleId,
      driverId: trip.driverId,
      status: trip.status,
      tempClass: trip.tempClass,
      waveId: trip.waveId,
      plannedDepartAt: trip.plannedDepartAt
        ? this.clock.toIso(trip.plannedDepartAt)
        : null,
      releasedAt: trip.releasedAt ? this.clock.toIso(trip.releasedAt) : null,
      releaseTempC: trip.releaseTempC,
      planRevision: trip.planRevision,
    };
  }

  /** The list is still the dock's to change. */
  private atDock(trip: LoadTripRow): boolean {
    return trip.status === 'PLANNED' || trip.status === 'LOADING';
  }

  private release(trip: LoadTripRow, actor: Actor): LinkMap {
    return {
      release: can(actor, 'load:release') &&
        tripMachine.can(trip.status, 'RELEASE') && {
          href: `/api/v1/trips/${trip.id}/release`,
          method: 'POST',
          title: 'Release the trip',
          requires:
            trip.tempClass === 'CHILLED'
              ? ['reeferTempC', 'checkedByName', 'clientUuid']
              : ['checkedByName', 'clientUuid'],
        },
    };
  }
}
