import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigModule } from '../config/config.module';
import { DatabaseModule } from '../db/database.module';
import { BullRootModule, QUEUES } from '../queues';
import { DemoInbox } from '../core/demo/demo-inbox';
import { AllocationProcessor } from './allocation.processor';
import { NotificationsProcessor } from './notifications.processor';

/** Background jobs: allocation runs, notifications, outbox relay, audit chain check. */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    BullRootModule,
    BullModule.registerQueue(
      { name: QUEUES.allocation },
      { name: QUEUES.notifications },
    ),
  ],
  providers: [AllocationProcessor, NotificationsProcessor, DemoInbox],
})
export class WorkerModule {}
