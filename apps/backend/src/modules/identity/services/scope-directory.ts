import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { asc, inArray } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { depots, outlets, vehicles } from '../../../db/schema';

/** The names behind a user's or an invitation's scope ids, for A1's "Linked to". */
export interface ScopeNames {
  depot: string | null;
  outlet: string | null;
  /** "REF-07 · WP CBA-1234": the vehicle's code and registration. */
  vehicle: string | null;
}

export interface ScopeIds {
  depotId: string | null;
  outletId: string | null;
  vehicleId: string | null;
}

/**
 * Depots, outlets and vehicles as A1 and A2 name and pick them. Reads master
 * data's and fleet's tables, writes nothing; when those modules publish
 * /depots, /outlets and /vehicles the screens can move to them.
 */
@Injectable()
export class ScopeDirectory {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  /** Everything a scope can point at (A2's "Link to"). */
  async options() {
    const tx = this.txHost.tx;
    const [depotRows, outletRows, vehicleRows] = await Promise.all([
      tx
        .select({ id: depots.id, name: depots.name })
        .from(depots)
        .orderBy(asc(depots.name)),
      tx
        .select({
          id: outlets.id,
          name: outlets.name,
          depotId: outlets.depotId,
        })
        .from(outlets)
        .orderBy(asc(outlets.name)),
      tx
        .select({
          id: vehicles.id,
          code: vehicles.code,
          registrationNo: vehicles.registrationNo,
          depotId: vehicles.depotId,
        })
        .from(vehicles)
        .orderBy(asc(vehicles.code)),
    ]);
    return { depots: depotRows, outlets: outletRows, vehicles: vehicleRows };
  }

  /** Names for many scopes at once: three small queries, whatever the page size. */
  async names(scopes: ScopeIds[]): Promise<ScopeNames[]> {
    const ids = (key: keyof ScopeIds) => [
      ...new Set(scopes.map((s) => s[key]).filter((v): v is string => !!v)),
    ];
    const tx = this.txHost.tx;
    const [depotIds, outletIds, vehicleIds] = [
      ids('depotId'),
      ids('outletId'),
      ids('vehicleId'),
    ];
    // inArray with no ids matches nothing, so empty pages cost three cheap queries.
    const [depotRows, outletRows, vehicleRows] = await Promise.all([
      tx
        .select({ id: depots.id, name: depots.name })
        .from(depots)
        .where(inArray(depots.id, depotIds)),
      tx
        .select({ id: outlets.id, name: outlets.name })
        .from(outlets)
        .where(inArray(outlets.id, outletIds)),
      tx
        .select({
          id: vehicles.id,
          code: vehicles.code,
          registrationNo: vehicles.registrationNo,
        })
        .from(vehicles)
        .where(inArray(vehicles.id, vehicleIds)),
    ]);
    const depot = new Map(depotRows.map((d) => [d.id, d.name]));
    const outlet = new Map(outletRows.map((o) => [o.id, o.name]));
    const vehicle = new Map(
      vehicleRows.map((v) => [v.id, `${v.code} · ${v.registrationNo}`]),
    );
    return scopes.map((s) => ({
      depot: (s.depotId && depot.get(s.depotId)) || null,
      outlet: (s.outletId && outlet.get(s.outletId)) || null,
      vehicle: (s.vehicleId && vehicle.get(s.vehicleId)) || null,
    }));
  }
}
