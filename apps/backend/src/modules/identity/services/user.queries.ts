import { Injectable } from '@nestjs/common';
import { type Actor, USER_ROLES } from '@waypoint/shared';
import { ilike, or } from 'drizzle-orm';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import {
  booleanFilter,
  contains,
  enumFilter,
  type ResourceSpec,
  textFilter,
} from '../../../core/persistence/resource-spec';
import { users } from '../../../db/schema';
import { UserScope } from '../policies/admin.scope';
import { ScopeDirectory, type ScopeNames } from './scope-directory';

export type UserRow = typeof users.$inferSelect;

/** A user with the names behind their scope ids, as A1 shows them. */
export type NamedUser = UserRow & { scopeNames: ScopeNames };

/** Users as a resource (A1): filter by role, depot, outlet or deactivation; search by name. */
export const USERS = {
  name: 'users',
  table: users,
  queryKey: 'users',
  pagination: 'offset',
  defaultSort: 'name',
  filters: {
    role: enumFilter(users.role, USER_ROLES),
    depotId: textFilter(users.depotId),
    outletId: textFilter(users.outletId),
    banned: booleanFilter(users.banned),
  },
  sorts: { name: users.name, role: users.role, createdAt: users.createdAt },
  search: (q) =>
    or(
      ilike(users.name, contains(q)),
      ilike(users.email, contains(q)),
      ilike(users.username, contains(q)),
    ),
} satisfies ResourceSpec<typeof users>;

@Injectable()
export class UserQueries {
  constructor(
    private readonly crud: CrudQueryService,
    private readonly scope: UserScope,
    private readonly directory: ScopeDirectory,
  ) {}

  async list(query: ListQuery, actor: Actor): Promise<Page<NamedUser>> {
    const page = await this.crud.list<UserRow>(
      USERS,
      query,
      this.scope.where(actor),
    );
    return { ...page, items: await this.named(page.items) };
  }

  /** One user, or 404 when missing or outside the caller's scope. */
  async get(id: string, actor: Actor): Promise<NamedUser> {
    const row = await this.crud.get<UserRow>(
      USERS,
      id,
      this.scope.where(actor),
    );
    return (await this.named([row]))[0];
  }

  /** Adds the depot, outlet and vehicle names to users from a command. */
  async named(rows: UserRow[]): Promise<NamedUser[]> {
    const names = await this.directory.names(
      rows.map((u) => ({
        depotId: u.depotId,
        outletId: u.outletId,
        vehicleId: u.defaultVehicleId,
      })),
    );
    return rows.map((u, i) => ({ ...u, scopeNames: names[i] }));
  }
}
