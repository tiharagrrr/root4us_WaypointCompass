import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { NotFoundError } from '../../../core/errors/domain-errors';
import { attachments, issues, orders } from '../../../db/schema';
import { ISSUE_RESOURCE } from '../issue.resource';
import { IssueScope } from '../policies/receipt.scope';
import { ISSUE_PHOTO_OWNER } from '../receipt.constants';

export type IssueRow = typeof issues.$inferSelect;

/** An issue with the two things a response adds: its order's number and its uploaded photos. */
export interface IssueView extends IssueRow {
  orderNo: string | null;
  photoIds: string[];
}

/**
 * The issue list and the issue detail, always inside the actor's scope: a store manager
 * sees their outlet's, a dispatcher their depot's (AC-RCP-11). A row outside it is a 404.
 */
@Injectable()
export class IssueQueries {
  constructor(
    private readonly crud: CrudQueryService,
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: IssueScope,
  ) {}

  async list(query: ListQuery, actor: Actor): Promise<Page<IssueView>> {
    const page = await this.crud.list<IssueRow>(
      ISSUE_RESOURCE,
      query,
      this.scope.where(actor),
    );
    return { ...page, items: await this.withExtras(page.items) };
  }

  async get(id: string, actor: Actor): Promise<IssueView> {
    const row = await this.crud.get<IssueRow>(
      ISSUE_RESOURCE,
      id,
      this.scope.where(actor),
    );
    return (await this.withExtras([row]))[0];
  }

  /**
   * The issue for someone adding a photo: the scope's readers, and the driver who raised
   * it, who can report an issue but read none (AC-RCP-11).
   */
  async getForPhoto(id: string, actor: Actor): Promise<IssueView> {
    if (actor.role !== 'driver') return this.get(id, actor);
    const [row] = await this.txHost.tx
      .select()
      .from(issues)
      .where(and(eq(issues.id, id), eq(issues.raisedById, actor.id)));
    if (!row) throw new NotFoundError('issue');
    return (await this.withExtras([row]))[0];
  }

  private async withExtras(rows: IssueRow[]): Promise<IssueView[]> {
    if (rows.length === 0) return [];
    const orderIds = [
      ...new Set(rows.flatMap((r) => (r.orderId ? [r.orderId] : []))),
    ];
    const numbers = orderIds.length
      ? new Map(
          (
            await this.txHost.tx
              .select({ id: orders.id, orderNo: orders.orderNo })
              .from(orders)
              .where(inArray(orders.id, orderIds))
          ).map((o) => [o.id, o.orderNo]),
        )
      : new Map<string, string>();
    const photos = await this.txHost.tx
      .select({ id: attachments.id, ownerId: attachments.ownerId })
      .from(attachments)
      .where(
        and(
          eq(attachments.ownerType, ISSUE_PHOTO_OWNER),
          inArray(
            attachments.ownerId,
            rows.map((r) => r.id),
          ),
          isNotNull(attachments.uploadedAt),
        ),
      )
      .orderBy(asc(attachments.id));
    return rows.map((row) => ({
      ...row,
      orderNo: row.orderId ? (numbers.get(row.orderId) ?? null) : null,
      photoIds: photos.filter((p) => p.ownerId === row.id).map((p) => p.id),
    }));
  }
}
