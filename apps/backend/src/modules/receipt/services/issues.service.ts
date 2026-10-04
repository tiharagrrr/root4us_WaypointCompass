import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, eq, ne } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  ForbiddenError,
  NotFoundError,
  StateConflictError,
  ValidationError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { issues } from '../../../db/schema';
import { AuditService } from '../../audit';
import { OrderLifecycleService, OrderQueries } from '../../ordering';
import type { CreateIssueDto, ResolveIssueDto } from '../dto/issue.dto';
import type {
  IssueReopenedEvent,
  IssueReportedEvent,
  IssueResolvedEvent,
} from '../events/receipt.events';
import { withinReopenWindow } from '../policies/issue.links';
import {
  RECEIPT_AUDIT,
  RECEIPT_EVENTS,
  RECEIPT_LOGS,
} from '../receipt.constants';
import { DeliveryReadModel } from './delivery.read-model';
import { IssueQueries, type IssueView } from './issue.queries';

/** An order from which a problem can still be reported: it has reached the store. */
const REPORTABLE = new Set(['DELIVERED', 'PARTIAL', 'RECEIVED']);

interface Target {
  orderId: string;
  orderStatus: string;
  orderVersion: number;
  outletId: string;
  depotId: string;
  stopId: string | null;
}

/**
 * Reporting, resolving and reopening issues (M6, the dispatcher's thread, D5). A store
 * reports on its own outlet's order with the order's version in If-Match; a driver reports
 * on a stop of their own trip. Either way the issue, its audit row and its outbox event
 * are one transaction, and the order moves to ISSUE_REPORTED through OrderLifecycleService
 * unless it already has, because ISSUE_REPORTED has no way out for a second REPORT.
 */
@Injectable()
export class IssuesService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly queries: IssueQueries,
    private readonly orders: OrderQueries,
    private readonly delivery: DeliveryReadModel,
    private readonly lifecycle: OrderLifecycleService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(IssuesService.name);
  }

  /** M6 (store) and D5 (driver): one issue about an order or a stop. */
  @Transactional()
  async create(
    dto: CreateIssueDto,
    actor: Actor,
    version?: number,
  ): Promise<IssueView> {
    const target = await this.targetFor(dto, actor);
    if (version !== undefined && target.orderVersion !== version)
      throw new VersionMismatchError('order');
    if (dto.orderLineId) {
      const ok = await this.delivery.lineIdsOf(target.orderId, [
        dto.orderLineId,
      ]);
      if (ok.length === 0)
        throw new ValidationError([
          {
            field: 'orderLineId',
            code: 'unknown',
            message: 'That line is not on this order.',
          },
        ]);
    }

    const [issue] = await this.txHost.tx
      .insert(issues)
      .values({
        outletId: target.outletId,
        orderId: target.orderId,
        stopId: target.stopId,
        orderLineId: dto.orderLineId ?? null,
        type: dto.type,
        qtyAffected: dto.qtyAffected ?? null,
        description: dto.description.trim(),
        raisedById: actor.id,
        raisedByRole: actor.role,
        createdAt: this.clock.realNow(),
      })
      .returning();

    if (REPORTABLE.has(target.orderStatus))
      await this.lifecycle.markIssueReported(target.orderId);

    await this.audit.record({
      action: RECEIPT_AUDIT.issueReported,
      entity: ['issue', issue.id],
      after: {
        type: issue.type,
        qtyAffected: issue.qtyAffected,
        orderId: target.orderId,
      },
      reasonCode: issue.type,
    });
    const event: IssueReportedEvent = {
      v: 1,
      issueId: issue.id,
      type: issue.type,
      outletId: target.outletId,
      orderId: target.orderId,
      ...(target.stopId && { stopId: target.stopId }),
      raisedById: actor.id,
      qtyAffected: issue.qtyAffected,
    };
    await this.outbox.add(RECEIPT_EVENTS.issueReported, event, {
      aggregate: ['issue', issue.id],
      depotId: target.depotId,
      outletIds: [target.outletId],
    });
    this.log.info(
      {
        event: RECEIPT_LOGS.issueReported,
        issueId: issue.id,
        orderId: target.orderId,
        type: issue.type,
        raisedByRole: actor.role,
      },
      'issue reported',
    );
    return this.readBack(issue.id, actor);
  }

  /** The dispatcher closes an issue with what is being done about it (AC-RCP-13). */
  @Transactional()
  async resolve(
    id: string,
    dto: ResolveIssueDto,
    actor: Actor,
  ): Promise<IssueView> {
    const before = await this.queries.get(id, actor);
    if (before.status === 'RESOLVED')
      throw new StateConflictError('This issue is already resolved.');

    const [row] = await this.txHost.tx
      .update(issues)
      .set({
        status: 'RESOLVED',
        resolution: dto.resolution,
        resolutionNote: dto.note?.trim() || null,
        resolvedById: actor.id,
        resolvedAt: this.clock.now(),
      })
      .where(and(eq(issues.id, id), ne(issues.status, 'RESOLVED')))
      .returning();
    if (!row) throw new StateConflictError('This issue is already resolved.');

    await this.audit.record({
      action: RECEIPT_AUDIT.issueResolved,
      entity: ['issue', id],
      before: { status: before.status },
      after: { status: row.status, resolution: row.resolution },
      reasonCode: dto.resolution,
      reasonNote: dto.note,
    });
    const event: IssueResolvedEvent = {
      v: 1,
      issueId: id,
      outletId: row.outletId,
      ...(row.orderId && { orderId: row.orderId }),
      resolution: dto.resolution,
    };
    await this.outbox.add(RECEIPT_EVENTS.issueResolved, event, {
      aggregate: ['issue', id],
      depotId: await this.depotOf(row.orderId),
      outletIds: [row.outletId],
    });
    this.log.info(
      {
        event: RECEIPT_AUDIT.issueResolved,
        issueId: id,
        resolution: dto.resolution,
      },
      'issue resolved',
    );
    return this.readBack(id, actor);
  }

  /** The store reopens a resolved issue within 48 hours of its resolution (AC-RCP-14). */
  @Transactional()
  async reopen(id: string, actor: Actor): Promise<IssueView> {
    if (actor.role !== 'store_manager')
      throw new ForbiddenError('Only the store reopens an issue.');
    const before = await this.queries.get(id, actor);
    if (before.status !== 'RESOLVED')
      throw new StateConflictError('Only a resolved issue can be reopened.');
    if (!withinReopenWindow(before.resolvedAt, this.clock.now()))
      throw new StateConflictError(
        'This issue was resolved more than 48 hours ago, so it cannot be reopened. Report a new issue instead.',
      );

    const [row] = await this.txHost.tx
      .update(issues)
      .set({
        status: 'OPEN',
        resolution: null,
        resolutionNote: null,
        resolvedById: null,
        resolvedAt: null,
      })
      .where(and(eq(issues.id, id), eq(issues.status, 'RESOLVED')))
      .returning();
    if (!row)
      throw new StateConflictError('Only a resolved issue can be reopened.');

    await this.audit.record({
      action: RECEIPT_AUDIT.issueReopened,
      entity: ['issue', id],
      before: { status: 'RESOLVED', resolution: before.resolution },
      after: { status: 'OPEN' },
    });
    const event: IssueReopenedEvent = {
      v: 1,
      issueId: id,
      outletId: row.outletId,
      ...(row.orderId && { orderId: row.orderId }),
    };
    await this.outbox.add(RECEIPT_EVENTS.issueReopened, event, {
      aggregate: ['issue', id],
      depotId: await this.depotOf(row.orderId),
      outletIds: [row.outletId],
    });
    this.log.info(
      { event: RECEIPT_AUDIT.issueReopened, issueId: id },
      'issue reopened',
    );
    return this.readBack(id, actor);
  }

  /**
   * What the issue is about, as the actor may see it: a store manager through their
   * outlet's orders, a driver through a stop on their own trip. Anything else is a 404.
   */
  private async targetFor(dto: CreateIssueDto, actor: Actor): Promise<Target> {
    if (!dto.orderId && !dto.stopId)
      throw new ValidationError([
        {
          field: 'orderId',
          code: 'required',
          message: 'Say which order or stop the issue is about.',
        },
      ]);

    if (actor.role === 'driver') {
      const found = await this.delivery.driverStop(actor.id, {
        stopId: dto.stopId,
        orderId: dto.orderId,
      });
      if (!found) throw new NotFoundError('stop');
      return {
        orderId: found.order.id,
        orderStatus: found.order.status,
        orderVersion: found.order.version,
        outletId: found.order.outletId,
        depotId: found.order.depotId,
        stopId: found.stop.id,
      };
    }

    if (!dto.orderId)
      throw new ValidationError([
        {
          field: 'orderId',
          code: 'required',
          message: 'Say which order the issue is about.',
        },
      ]);
    const order = await this.orders.get(dto.orderId, actor);
    return {
      orderId: order.id,
      orderStatus: order.status,
      orderVersion: order.version,
      outletId: order.outletId,
      depotId: order.depotId,
      stopId: order.activeStopId,
    };
  }

  /** The issue's depot for routing its events, read through the order (the issue has an outlet only). */
  private async depotOf(orderId: string | null): Promise<string | undefined> {
    if (!orderId) return undefined;
    return (await this.delivery.orderById(orderId))?.depotId;
  }

  private readBack(id: string, actor: Actor): Promise<IssueView> {
    // A driver may report but not read; give them back the row they just made.
    return actor.role === 'driver'
      ? this.queries.getForPhoto(id, actor)
      : this.queries.get(id, actor);
  }
}
