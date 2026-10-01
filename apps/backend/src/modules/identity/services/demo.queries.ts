import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { isUserRole, USER_ROLES, type UserRole } from '@waypoint/shared';
import { asc, inArray, sql } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { AppConfig } from '../../../config/app-config';
import { NotFoundError } from '../../../core/errors/domain-errors';
import { users } from '../../../db/schema';
import { ScopeDirectory, type ScopeNames } from './scope-directory';

export interface DemoCastMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  depotId: string | null;
  outletId: string | null;
  vehicleId: string | null;
  scopeNames: ScopeNames;
}

/** The order the account menu lists the cast in: the judge's path through the day. */
const ROLE_ORDER: readonly UserRole[] = [
  'store_manager',
  'dispatcher',
  'loader',
  'driver',
  'admin',
];

/**
 * Who the demo can switch between, for the account menu. Demo mode only: outside it the route
 * answers 404, as the other demo tools do.
 */
@Injectable()
export class DemoQueries {
  constructor(
    private readonly config: AppConfig,
    private readonly directory: ScopeDirectory,
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  async cast(): Promise<DemoCastMember[]> {
    if (!this.config.demo.enabled) throw new NotFoundError('demo users');
    const rows = await this.txHost.tx
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        depotId: users.depotId,
        outletId: users.outletId,
        vehicleId: users.defaultVehicleId,
      })
      .from(users)
      .where(
        sql`not coalesce(${users.banned}, false) and ${inArray(users.role, [...USER_ROLES])}`,
      )
      .orderBy(asc(users.role), asc(users.name));

    const named = await this.directory.names(
      rows.map((u) => ({
        depotId: u.depotId,
        outletId: u.outletId,
        vehicleId: u.vehicleId,
      })),
    );
    return rows
      .flatMap((u, i) =>
        isUserRole(u.role)
          ? [{ ...u, role: u.role, scopeNames: named[i] }]
          : [],
      )
      .sort(
        (a, b) =>
          ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
          a.name.localeCompare(b.name),
      );
  }
}
