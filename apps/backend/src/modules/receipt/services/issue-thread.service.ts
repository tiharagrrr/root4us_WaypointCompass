import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { asc, eq, and } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { comments } from '../../../db/schema';
import { AuditService } from '../../audit';
import type { IssueCommentedEvent } from '../events/receipt.events';
import {
  ISSUE_COMMENT_ENTITY,
  RECEIPT_AUDIT,
  RECEIPT_EVENTS,
} from '../receipt.constants';
import { DeliveryReadModel } from './delivery.read-model';
import { IssueQueries } from './issue.queries';

export type CommentRow = typeof comments.$inferSelect;

/**
 * The store and dispatcher thread on an issue (AC-RCP-12). Comments live in the shared
 * comments table with entityType `issue`: plain text, never edited or deleted, and every
 * one audited. The thread is read and written through the issue's scope, so another
 * outlet's thread is a 404 and a driver, who holds no `issue:read`, is refused earlier.
 */
@Injectable()
export class IssueThreadService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly issues: IssueQueries,
    private readonly delivery: DeliveryReadModel,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(IssueThreadService.name);
  }

  async list(issueId: string, actor: Actor): Promise<CommentRow[]> {
    await this.issues.get(issueId, actor);
    return this.txHost.tx
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.entityType, ISSUE_COMMENT_ENTITY),
          eq(comments.entityId, issueId),
        ),
      )
      .orderBy(asc(comments.createdAt), asc(comments.id));
  }

  @Transactional()
  async post(issueId: string, body: string, actor: Actor): Promise<CommentRow> {
    const issue = await this.issues.get(issueId, actor);
    const [row] = await this.txHost.tx
      .insert(comments)
      .values({
        entityType: ISSUE_COMMENT_ENTITY,
        entityId: issueId,
        authorId: actor.id,
        authorRole: actor.role,
        authorName: actor.name,
        body: body.trim(),
        readBy: [actor.id],
      })
      .returning();

    // Never the body or the author's name: the audit row and the event carry ids only.
    await this.audit.record({
      action: RECEIPT_AUDIT.issueCommented,
      entity: ['comment', row.id],
      after: { issueId, authorRole: actor.role },
    });
    const event: IssueCommentedEvent = {
      v: 1,
      issueId,
      commentId: row.id,
      outletId: issue.outletId,
      ...(issue.orderId && { orderId: issue.orderId }),
    };
    const depotId = issue.orderId
      ? (await this.delivery.orderById(issue.orderId))?.depotId
      : undefined;
    await this.outbox.add(RECEIPT_EVENTS.issueCommented, event, {
      aggregate: ['issue', issueId],
      depotId,
      outletIds: [issue.outletId],
    });
    this.log.info(
      { event: RECEIPT_AUDIT.issueCommented, issueId, commentId: row.id },
      'issue commented',
    );
    return row;
  }
}
