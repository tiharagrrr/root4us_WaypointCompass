import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { NotFoundError } from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  depots,
  districts,
  roadConditions,
  serviceAllowances,
  trafficSpeeds,
} from '../../../db/schema';

export type DepotRow = typeof depots.$inferSelect;
export type DistrictRow = typeof districts.$inferSelect;

/**
 * The reference tables every role reads: depots, districts, service
 * allowances, traffic speeds and road conditions (AC-MD-11). Small, stable
 * lists, so they return whole rather than paged.
 */
@Injectable()
export class ReferenceQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  depots(): Promise<DepotRow[]> {
    return this.txHost.tx.select().from(depots).orderBy(asc(depots.id));
  }

  async depot(id: string): Promise<DepotRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(depots)
      .where(eq(depots.id, id));
    if (!row) throw new NotFoundError('depot');
    return row;
  }

  districts(): Promise<DistrictRow[]> {
    return this.txHost.tx.select().from(districts).orderBy(asc(districts.name));
  }

  serviceAllowances() {
    return this.txHost.tx
      .select()
      .from(serviceAllowances)
      .orderBy(asc(serviceAllowances.brand), asc(serviceAllowances.dockType));
  }

  trafficSpeeds(districtId?: string) {
    return this.txHost.tx
      .select()
      .from(trafficSpeeds)
      .where(districtId ? eq(trafficSpeeds.districtId, districtId) : undefined)
      .orderBy(asc(trafficSpeeds.districtId), asc(trafficSpeeds.hour));
  }

  roadConditions(range?: { from?: string; to?: string }) {
    const where = and(
      range?.from ? gte(roadConditions.date, range.from) : undefined,
      range?.to ? lte(roadConditions.date, range.to) : undefined,
    );
    return this.txHost.tx
      .select()
      .from(roadConditions)
      .where(where)
      .orderBy(asc(roadConditions.date), asc(roadConditions.districtId));
  }
}
