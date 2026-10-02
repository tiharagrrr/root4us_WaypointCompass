import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { inArray } from 'drizzle-orm';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { items } from '../../../db/schema';
import { ITEM_RESOURCE } from '../item.resource';

export type ItemRow = typeof items.$inferSelect;

/** The catalog behind M1a's picker and M9; readable by every role with catalog:read. */
@Injectable()
export class ItemQueries {
  constructor(
    private readonly crud: CrudQueryService,
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  list(query: ListQuery): Promise<Page<ItemRow>> {
    return this.crud.list<ItemRow>(ITEM_RESOURCE, query);
  }

  get(id: string): Promise<ItemRow> {
    return this.crud.get<ItemRow>(ITEM_RESOURCE, id);
  }

  /** The rows behind a set of ids, keyed by id: order lines snapshot them. */
  async byIds(ids: readonly string[]): Promise<Map<string, ItemRow>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.txHost.tx
      .select()
      .from(items)
      .where(inArray(items.id, unique));
    return new Map(rows.map((row) => [row.id, row]));
  }
}
