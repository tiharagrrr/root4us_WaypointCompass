// apps/backend/src/modules/ordering/ordering.module.ts · owner: Harini
// Store orders from draft to the 16:00 cutoff, templates and reorders.
// Spec: specs/ordering/spec.md. Tables: src/db/schema/ordering.ts.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { MasterDataModule } from '../master-data';
import { DepotDaysController } from './controllers/depot-days.controller';
import { OrderLinesController } from './controllers/order-lines.controller';
import { OrderTemplatesController } from './controllers/order-templates.controller';
import { OrdersController } from './controllers/orders.controller';
import { ReceivingRosterController } from './controllers/receiving-roster.controller';
import { CutoffProcessor } from './jobs/cutoff.processor';
import { DepotDayLinks } from './policies/depot-day.links';
import { OrderTemplateLinks } from './policies/order-template.links';
import { OrderLinks } from './policies/order.links';
import { OrderRules } from './policies/order.rules';
import {
  OrderScope,
  OrderTemplateScope,
  ReceivingRosterScope,
} from './policies/order.scope';
import { ReceivingRosterLinks } from './policies/receiving-roster.links';
import { CutoffCloseService } from './services/cutoff-close.service';
import { CutoffReminderService } from './services/cutoff-reminder.service';
import { CutoffService } from './services/cutoff.service';
import { DepotDayQueries } from './services/depot-day.queries';
import { OrderLifecycleService } from './services/order-lifecycle.service';
import { OrderLinesService } from './services/order-lines.service';
import { OrderLinesValidator } from './services/order-lines.validator';
import { OrderNumberService } from './services/order-number.service';
import { OrderQueries } from './services/order.queries';
import { OrderViews } from './services/order.views';
import { OrdersService } from './services/orders.service';
import { RosterService } from './services/roster.service';
import { TemplatesService } from './services/templates.service';

const providers = [
  CutoffCloseService,
  CutoffProcessor,
  CutoffReminderService,
  CutoffService,
  DepotDayLinks,
  DepotDayQueries,
  OrderLifecycleService,
  OrderLinks,
  OrderLinesService,
  OrderLinesValidator,
  OrderNumberService,
  OrderQueries,
  OrderRules,
  OrderScope,
  OrderTemplateLinks,
  OrderTemplateScope,
  OrderViews,
  OrdersService,
  ReceivingRosterLinks,
  ReceivingRosterScope,
  RosterService,
  TemplatesService,
];

@Module({
  imports: [AuditModule, MasterDataModule],
  controllers: [
    OrdersController,
    OrderLinesController,
    OrderTemplatesController,
    ReceivingRosterController,
    DepotDaysController,
  ],
  providers,
  // Planning, loading, execution and receipt move an order's status only
  // through OrderLifecycleService, and read the queue through OrderQueries.
  exports: [OrderLifecycleService, OrderQueries, CutoffService],
})
export class OrderingModule {}
