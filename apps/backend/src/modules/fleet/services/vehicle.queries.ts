import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type Actor, can } from '@waypoint/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import { users, vehicles } from '../../../db/schema';
import { VehicleScope } from '../policies/vehicle.scope';
import { VEHICLE_RESOURCE } from '../vehicle.resource';

export type VehicleRow = typeof vehicles.$inferSelect;

/** The driver this vehicle is the usual ride of (A5). */
export interface VehicleDriver {
  id: string;
  name: string;
}

/** A vehicle with the driver linked to it, or null when none is. */
export type VehicleView = VehicleRow & { driver: VehicleDriver | null };

/** Reads of vehicles: the planner's scoped read, and the depot's fleet for the engine. */
@Injectable()
export class VehicleQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: VehicleScope,
    private readonly crud: CrudQueryService,
  ) {}

  /** A5's page of vehicles, within the caller's depot scope. */
  async list(query: ListQuery, actor: Actor): Promise<Page<VehicleView>> {
    const page = await this.crud.list<VehicleRow>(
      VEHICLE_RESOURCE,
      query,
      this.scope.where(actor),
    );
    const drivers = await this.driversOf(
      page.items.map((v) => v.id),
      actor,
    );
    return {
      ...page,
      items: page.items.map((v) => ({
        ...v,
        driver: drivers.get(v.id) ?? null,
      })),
    };
  }

  /** One vehicle with its driver, for A5's row and its dialog. */
  async view(id: string, actor: Actor): Promise<VehicleView> {
    const row = await this.get(id, actor);
    const drivers = await this.driversOf([id], actor);
    return { ...row, driver: drivers.get(id) ?? null };
  }

  /**
   * The active driver linked to each vehicle, keyed by vehicle id. A read of
   * identity's table (`users.defaultVehicleId`), not of its module: fleet
   * imports only audit and master-data. Only a planner or an admin sees who
   * drives what, so a store manager reading a vehicle learns no names.
   */
  private async driversOf(
    ids: readonly string[],
    actor: Actor,
  ): Promise<Map<string, VehicleDriver>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0 || !can(actor, 'plan:read')) return new Map();
    const rows = await this.txHost.tx
      .select({
        id: users.id,
        name: users.name,
        vehicleId: users.defaultVehicleId,
      })
      .from(users)
      .where(
        and(
          inArray(users.defaultVehicleId, unique),
          eq(users.role, 'driver'),
          sql`${users.banned} is not true`,
        ),
      )
      .orderBy(asc(users.id));
    const drivers = new Map<string, VehicleDriver>();
    for (const row of rows)
      if (row.vehicleId && !drivers.has(row.vehicleId))
        drivers.set(row.vehicleId, { id: row.id, name: row.name });
    return drivers;
  }

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
