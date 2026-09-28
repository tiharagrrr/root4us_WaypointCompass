import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MetricsController } from './metrics/metrics.controller';
import { BullRootModule, QUEUES } from './queues';

// Domain modules (identity, master-data, ordering, planning, fleet, loading,
// execution, receipt, sync, notifications, audit) plug in here. See
// docs/architecture.md for their boundaries.
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    BullRootModule,
    BullModule.registerQueue({ name: QUEUES.allocation }, { name: QUEUES.notifications }),
    HealthModule,
  ],
  controllers: [AppController, MetricsController],
  providers: [AppService],
})
export class AppModule {}
