import { Injectable } from '@nestjs/common';
import { alertMachine, can, type Actor } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { AlertSeverity } from '../alerts.constants';
import { catalogFor } from '../domain/catalog';
import { subjectOf } from '../domain/dedupe-key';
import type { AlertDto } from '../dto/alert.dto';
import type { AlertRow } from '../services/alerts.service';

const BASE = '/api/v1/alerts';

const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  1: 'Critical',
  2: 'Warning',
  3: 'Information',
};

/**
 * An alert with the actions allowed right now — the affordance rule applied
 * to a resource whose whole purpose is to point at an action somewhere else.
 *
 * Three gates, and a link appears only when all three pass:
 *
 * 1. **The state machine.** `acknowledge` while it is open, `resolve` until it
 *    closes, and once it is RESOLVED nothing at all: no acknowledge, no
 *    resolve, and no fix either, because there is nothing left to fix
 *    (AC-ALR-03, AC-ALR-07).
 * 2. **The permission.** `alert:act` for acknowledge and resolve; for a fix,
 *    the permission the *fixing* endpoint is guarded by, which the catalog
 *    records next to its href. A dispatcher without `load:decide` is offered
 *    no flag decision, and the alert's other links are unchanged (AC-ALR-07).
 * 3. **The ids.** A fix link needs the alert to carry what its path is built
 *    from; a LATE_RISK alert with no tripId gets no re-sequence link rather
 *    than a broken one.
 *
 * The scope is the fourth gate and is already closed by the time a row gets
 * here: AlertScope answers 404 for another depot's alert, so there is no
 * viewer to render links for.
 */
@Injectable()
export class AlertLinks extends LinkBuilder<
  AlertRow,
  Omit<AlertDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(alert: AlertRow) {
    return `${BASE}/${alert.id}`;
  }

  protected actions(alert: AlertRow, actor: Actor): LinkMap {
    const self = this.self(alert);
    const acts = can(actor, 'alert:act');
    return {
      ...this.fixes(alert, actor),
      trip: alert.tripId ? { href: `/api/v1/trips/${alert.tripId}` } : false,
      order: alert.orderId
        ? { href: `/api/v1/orders/${alert.orderId}` }
        : false,
      acknowledge: acts &&
        alertMachine.can(alert.status, 'ACKNOWLEDGE') && {
          href: `${self}/acknowledge`,
          method: 'POST',
          title: "I'm on it",
        },
      resolve: acts &&
        alertMachine.can(alert.status, 'RESOLVE') && {
          href: `${self}/resolve`,
          method: 'POST',
          title: 'Resolve',
          requires: ['note'],
        },
    };
  }

  /**
   * The fix links from the catalog, each kept only if this viewer may take it.
   * A resolved alert gets none: the fix has happened.
   */
  private fixes(alert: AlertRow, actor: Actor): LinkMap {
    if (alert.status === 'RESOLVED') return {};
    const fix = {
      planId: alert.planId,
      tripId: alert.tripId,
      stopId: alert.stopId,
      orderId: alert.orderId,
      subject: subjectOf(alert.dedupeKey),
    };
    return Object.fromEntries(
      catalogFor(alert.type).fixes.flatMap((spec) => {
        if (!can(actor, spec.permission)) return [];
        const href = spec.href(fix);
        if (!href) return [];
        return [
          [
            spec.rel,
            {
              href,
              method: spec.method ?? 'GET',
              title: spec.title,
              ...(spec.requires ? { requires: [...spec.requires] } : {}),
            },
          ],
        ];
      }),
    );
  }

  protected present(alert: AlertRow): Omit<AlertDto, '_links'> {
    const iso = (at: Date | null) => (at ? this.clock.toIso(at) : null);
    const severity = alert.severity as AlertSeverity;
    return {
      id: alert.id,
      type: alert.type,
      status: alert.status,
      severity: alert.severity,
      severityLabel: SEVERITY_LABELS[severity] ?? 'Warning',
      title: alert.title,
      depotId: alert.depotId,
      detail: alert.detail,
      dedupeKey: alert.dedupeKey,
      tripId: alert.tripId,
      stopId: alert.stopId,
      orderId: alert.orderId,
      outletId: alert.outletId,
      raisedById: alert.raisedById,
      raisedAt: this.clock.toIso(alert.raisedAt),
      acknowledgedById: alert.acknowledgedById,
      acknowledgedAt: iso(alert.acknowledgedAt),
      resolvedById: alert.resolvedById,
      resolvedAt: iso(alert.resolvedAt),
      resolution: alert.resolution,
      resolvesWhen: catalogFor(alert.type).resolvesWhen,
    };
  }
}
