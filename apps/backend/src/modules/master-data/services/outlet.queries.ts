import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { outlets, users } from '../../../db/schema';
import { OUTLET_RESOURCE } from '../outlet.resource';
import { OutletScope } from '../policies/master-data.scope';

export type OutletRow = typeof outlets.$inferSelect;

/** Who manages the outlet, as A3 shows it beside the row. */
export interface OutletManager {
  id: string;
  name: string;
}

/** An outlet with its store manager, or null when nobody manages it (AC-MD-05). */
export type OutletView = OutletRow & { manager: OutletManager | null };

/** Outlets for A3 and for anything that needs an order's outlet (M1's card). */
@Injectable()
export class OutletQueries {
  constructor(
    private readonly crud: CrudQueryService,
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: OutletScope,
  ) {}

  async list(query: ListQuery, actor: Actor): Promise<Page<OutletView>> {
    const page = await this.crud.list<OutletRow>(
      OUTLET_RESOURCE,
      query,
      this.scope.where(actor),
    );
    const managers = await this.managersOf(page.items.map((o) => o.id));
    return {
      ...page,
      items: page.items.map((o) => ({
        ...o,
        manager: managers.get(o.id) ?? null,
      })),
    };
  }

  async get(id: string, actor: Actor): Promise<OutletView> {
    const row = await this.crud.get<OutletRow>(
      OUTLET_RESOURCE,
      id,
      this.scope.where(actor),
    );
    return { ...row, manager: (await this.managersOf([id])).get(id) ?? null };
  }

  /**
   * The active store manager of each outlet, keyed by outlet id. A read of
   * identity's table (master-data imports only core and audit); the one with
   * the lowest id wins where an outlet somehow has two.
   */
  private async managersOf(
    ids: readonly string[],
  ): Promise<Map<string, OutletManager>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.txHost.tx
      .select({ id: users.id, name: users.name, outletId: users.outletId })
      .from(users)
      .where(
        and(
          inArray(users.outletId, unique),
          eq(users.role, 'store_manager'),
          sql`${users.banned} is not true`,
        ),
      )
      .orderBy(users.id);
    const managers = new Map<string, OutletManager>();
    for (const row of rows)
      if (row.outletId && !managers.has(row.outletId))
        managers.set(row.outletId, { id: row.id, name: row.name });
    return managers;
  }

  /** The rows behind a set of ids, keyed by id; no scope, for hydrating orders. */
  async byIds(ids: readonly string[]): Promise<Map<string, OutletRow>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.txHost.tx
      .select()
      .from(outlets)
      .where(inArray(outlets.id, unique));
    return new Map(rows.map((row) => [row.id, row]));
  }
}
