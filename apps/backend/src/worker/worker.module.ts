import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { BullRootModule, QUEUES } from '../queues';
import { AllocationProcessor } from './allocation.processor';

/** Background jobs: allocation runs, notifications, outbox relay, audit chain check. */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    BullRootModule,
    BullModule.registerQueue({ name: QUEUES.allocation }, { name: QUEUES.notifications }),
  ],
  providers: [AllocationProcessor],
})
export class WorkerModule {}
