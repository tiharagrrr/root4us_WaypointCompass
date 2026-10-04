import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { asc, eq } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { positionPings } from '../../../db/schema';
import { MyTripsQueries } from './my-trips.queries';

export interface TrailPoint {
  lat: number;
  lng: number;
  recordedAt: string;
}

/** 19a's breadcrumb: the trip's sampled trail, oldest first, within the caller's trip scope. */
@Injectable()
export class TrailQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly trips: MyTripsQueries,
    private readonly clock: ClockService,
  ) {}

  async trail(tripId: string, actor: Actor): Promise<TrailPoint[]> {
    // 404 for a trip outside the scope, before anything else is read.
    await this.trips.get(tripId, actor);
    const rows = await this.txHost.tx
      .select({
        lat: positionPings.lat,
        lng: positionPings.lng,
        recordedAt: positionPings.recordedAt,
      })
      .from(positionPings)
      .where(eq(positionPings.tripId, tripId))
      .orderBy(asc(positionPings.recordedAt));
    return rows.map((r) => ({
      lat: r.lat,
      lng: r.lng,
      recordedAt: this.clock.toIso(r.recordedAt),
    }));
  }
}
