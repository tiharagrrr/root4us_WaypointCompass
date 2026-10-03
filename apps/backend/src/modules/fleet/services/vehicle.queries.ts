import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { vehicles } from '../../../db/schema';
import { VehicleScope } from '../policies/vehicle.scope';

export type VehicleRow = typeof vehicles.$inferSelect;

/** Reads of vehicles: the planner's scoped read, and the depot's fleet for the engine. */
@Injectable()
export class VehicleQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: VehicleScope,
  ) {}

  /** One vehicle, or 404 when it is missing or outside the caller's depot. */
  async get(id: string, actor: Actor): Promise<VehicleRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), this.scope.where(actor)));
    return this.scope.found(row);
  }

  /**
   * Every vehicle based at a depot, whatever its status, sorted by id so the
   * engine's input is the same every time. A vehicle not ACTIVE still goes
   * in: the engine shows it as unavailable with its reason (06).
   *
   * No actor scope: planning calls this for a plan it already holds in its
   * own scope.
   */
  forDepot(depotId: string): Promise<VehicleRow[]> {
    return this.txHost.tx
      .select()
      .from(vehicles)
      .where(eq(vehicles.depotId, depotId))
      .orderBy(asc(vehicles.id));
  }
}
