// apps/backend/src/modules/receipt/receipt.module.ts · owner: Harini
// Store receipt confirmation and issues.
// Spec: specs/receipt/spec.md. Tables: src/db/schema/receipt.ts.
import { Module, type OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../core/outbox/event-bus';
import { AuditModule } from '../audit';
import { OrderingModule } from '../ordering';
import { IssuesController } from './controllers/issues.controller';
import { ReceiptsController } from './controllers/receipts.controller';
import { CommentLinks } from './policies/comment.links';
import { IssueLinks } from './policies/issue.links';
import { ReceiptLinks } from './policies/receipt.links';
import { IssueScope } from './policies/receipt.scope';
import { DeliveryReadModel } from './services/delivery.read-model';
import { IssuePhotosService } from './services/issue-photos.service';
import { IssueQueries } from './services/issue.queries';
import { IssueThreadService } from './services/issue-thread.service';
import { IssuesService } from './services/issues.service';
import { ReceiptEventListener } from './services/receipt-event.listener';
import { ReceiptQueries } from './services/receipt.queries';
import { ReceiptService } from './services/receipt.service';

/**
 * Receipt imports audit and ordering (specs/receipt/spec.md, depends-on):
 *
 * - **ordering** for `OrderLifecycleService`, the one way an order's status moves, and
 *   `OrderQueries`, which reads an order inside the caller's scope;
 * - **audit** for the trail every change writes.
 *
 * The driver's record (the stop, its delivery lines and its proof of delivery) is read by
 * `DeliveryReadModel` straight from execution's tables, read-only, so execution's module
 * is not touched. `stop.completed` arrives as an event: `ReceiptEventListener` is
 * registered on the `EventBus`, so the outbox relay delivers it and a receipt confirmed
 * early is reconciled.
 */
@Module({
  imports: [AuditModule, OrderingModule],
  controllers: [ReceiptsController, IssuesController],
  providers: [
    CommentLinks,
    DeliveryReadModel,
    IssueLinks,
    IssuePhotosService,
    IssueQueries,
    IssueScope,
    IssueThreadService,
    IssuesService,
    ReceiptEventListener,
    ReceiptLinks,
    ReceiptQueries,
    ReceiptService,
  ],
  exports: [],
})
export class ReceiptModule implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly listener: ReceiptEventListener,
  ) {}

  onModuleInit(): void {
    this.bus.register({
      name: 'receipt',
      consumes: (type) => ReceiptEventListener.consumes(type),
      handle: (event) => this.listener.handle(event),
    });
  }
}
