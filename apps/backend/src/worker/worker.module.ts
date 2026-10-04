import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DiscoveryModule } from '@nestjs/core';
import { AppModule } from '../app.module';
import { NotificationsModule } from '../modules/notifications';
import { PlanningModule } from '../modules/planning';
import { DemoInbox } from '../core/demo/demo-inbox';
import { TickerService } from '../core/scheduling/ticker.service';
import { QUEUES } from '../queues';
import { AllocationProcessor } from './allocation.processor';
import { NotificationsProcessor } from './notifications.processor';
import { OutboxProcessor } from './outbox.processor';
import { TickerProcessor } from './ticker.processor';

/**
 * The worker loads AppModule, so jobs call the same command services as the
 * API, and adds what only the worker runs: BullMQ processors and the
 * one-minute ticker. Background jobs: allocation runs, notifications, outbox
 * relay, audit chain check.
 */
@Module({
  imports: [
    AppModule,
    // For EngineRunner, which the allocation processor drives.
    PlanningModule,
    // For NotificationSender, which notify.send drives.
    NotificationsModule,
    DiscoveryModule,
    BullModule.registerQueue({ name: QUEUES.ticker }),
    BullModule.registerQueue({ name: QUEUES.outbox }),
  ],
  providers: [
    AllocationProcessor,
    NotificationsProcessor,
    OutboxProcessor,
    DemoInbox,
    TickerService,
    TickerProcessor,
  ],
})
export class WorkerModule {}
