import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { inArray } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { outlets } from '../../../db/schema';
import { OUTLET_RESOURCE } from '../outlet.resource';
import { OutletScope } from '../policies/master-data.scope';

export type OutletRow = typeof outlets.$inferSelect;

/** Outlets for A3 and for anything that needs an order's outlet (M1's card). */
@Injectable()
export class OutletQueries {
  constructor(
    private readonly crud: CrudQueryService,
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: OutletScope,
  ) {}

  list(query: ListQuery, actor: Actor): Promise<Page<OutletRow>> {
    return this.crud.list<OutletRow>(
      OUTLET_RESOURCE,
      query,
      this.scope.where(actor),
    );
  }

  get(id: string, actor: Actor): Promise<OutletRow> {
    return this.crud.get<OutletRow>(
      OUTLET_RESOURCE,
      id,
      this.scope.where(actor),
    );
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
