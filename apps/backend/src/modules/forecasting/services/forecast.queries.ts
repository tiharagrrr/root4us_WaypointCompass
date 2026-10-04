import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type Actor, addDays } from '@waypoint/shared';
import { and, eq, gte, lt, notInArray, or, sql } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  demandForecasts,
  depots,
  orders,
  users,
  vehicles,
} from '../../../db/schema';
import { CalendarService } from '../../master-data';
import {
  type Brand,
  type CalendarDay,
  type DailyMean,
  type Fleet,
  forecastWeek,
  HISTORY_WINDOW_DAYS,
  type StoredForecast,
  type WeekForecast,
  weeksAhead,
} from '../domain/weekly-forecast';
import { ForecastScope } from '../policies/forecast.scope';

export interface DepotForecast {
  depotId: string;
  fleet: Fleet;
  weeks: WeekForecast[];
}

/** 22's read: the weeks ahead for one depot, against its fleet. */
@Injectable()
export class ForecastQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: ForecastScope,
    private readonly calendar: CalendarService,
  ) {}

  /** The `count` ISO weeks after today's, or 404 when the depot is out of scope. */
  async weeksAhead(
    depotId: string,
    today: string,
    count: number,
    actor: Actor,
    brand?: Brand,
  ): Promise<DepotForecast> {
    const [depot] = await this.txHost.tx
      .select({ id: depots.id })
      .from(depots)
      .where(and(eq(depots.id, depotId), this.scope.where(actor)));
    this.scope.found(depot);

    const weeks = weeksAhead(today, count);
    const last = weeks[weeks.length - 1];
    // One after another: they share the request's transaction, one connection.
    const days = await this.calendar.range(weeks[0].weekStart, last.days[6]);
    const stored = await this.stored(depotId, weeks);
    const history = await this.history(depotId, today);
    const fleet = await this.fleet(depotId);
    const calendar = new Map<string, CalendarDay>(days.map((d) => [d.date, d]));
    return {
      depotId,
      fleet,
      weeks: weeks.map((week) =>
        forecastWeek(week, { calendar, stored, history, fleet, brand }),
      ),
    };
  }

  /** The stored forecast rows for these weeks, imported and baseline alike. */
  private stored(
    depotId: string,
    weeks: readonly { isoYear: number; isoWeek: number }[],
  ): Promise<StoredForecast[]> {
    return this.txHost.tx
      .select({
        brand: demandForecasts.brand,
        isoYear: demandForecasts.isoYear,
        isoWeek: demandForecasts.isoWeek,
        totalVolumeM3: demandForecasts.totalVolumeM3,
        chilledVolumeM3: demandForecasts.chilledVolumeM3,
        source: demandForecasts.source,
      })
      .from(demandForecasts)
      .where(
        and(
          eq(demandForecasts.depotId, depotId),
          or(
            ...weeks.map((w) =>
              and(
                eq(demandForecasts.isoYear, w.isoYear),
                eq(demandForecasts.isoWeek, w.isoWeek),
              ),
            ),
          ),
        ),
      );
  }

  /**
   * Each brand's mean volume per day that had orders, over the weeks before
   * today. A read of ordering's table, not of its module: forecasting needs
   * only the totals. Drafts and cancelled orders are not demand.
   */
  private async history(
    depotId: string,
    today: string,
  ): Promise<Map<Brand, DailyMean>> {
    const rows = await this.txHost.tx
      .select({
        brand: orders.brand,
        days: sql<number>`count(distinct ${orders.requestedDate})::int`,
        total: sql<number>`coalesce(sum(${orders.volumeM3}), 0)::float8`,
        chilled: sql<number>`coalesce(sum(${orders.volumeM3}) filter (where ${orders.tempClass} = 'CHILLED'), 0)::float8`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.depotId, depotId),
          gte(orders.requestedDate, addDays(today, -HISTORY_WINDOW_DAYS)),
          lt(orders.requestedDate, today),
          notInArray(orders.status, ['DRAFT', 'CANCELLED']),
        ),
      )
      .groupBy(orders.brand);
    return new Map(
      rows
        .filter((r) => r.days > 0)
        .map((r) => [
          r.brand,
          {
            totalVolumeM3: r.total / r.days,
            chilledVolumeM3: r.chilled / r.days,
          },
        ]),
    );
  }

  /**
   * The depot's vehicles that can run today and its active drivers. Reads of
   * fleet's and identity's tables, not of their modules (the spec's
   * depends-on does not list them). A vehicle in the workshop or broken down
   * is left out: its status stands until someone marks it ACTIVE again.
   */
  private async fleet(depotId: string): Promise<Fleet> {
    const [fleet] = await this.txHost.tx
      .select({
        vehicles: sql<number>`count(*)::int`,
        reefers: sql<number>`(count(*) filter (where ${vehicles.temp} = 'REEFER'))::int`,
        volumeCapM3: sql<number>`coalesce(sum(${vehicles.volumeCapM3}), 0)::float8`,
        reeferVolumeCapM3: sql<number>`coalesce(sum(${vehicles.volumeCapM3}) filter (where ${vehicles.temp} = 'REEFER'), 0)::float8`,
      })
      .from(vehicles)
      .where(and(eq(vehicles.depotId, depotId), eq(vehicles.status, 'ACTIVE')));
    const [crew] = await this.txHost.tx
      .select({ drivers: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.depotId, depotId),
          eq(users.role, 'driver'),
          sql`${users.banned} is not true`,
        ),
      );
    return { ...fleet, drivers: crew.drivers };
  }
}
