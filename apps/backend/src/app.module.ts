import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './db/database.module';
import { HealthModule } from './health/health.module';
import { MetricsController } from './metrics/metrics.controller';
import { AlertsModule } from './modules/alerts';
import { AuditModule } from './modules/audit';
import { ExecutionModule } from './modules/execution';
import { FleetModule } from './modules/fleet';
import { ForecastingModule } from './modules/forecasting';
import { IdentityModule } from './modules/identity';
import { LoadingModule } from './modules/loading';
import { MasterDataModule } from './modules/master-data';
import { NotificationsModule } from './modules/notifications';
import { OrderingModule } from './modules/ordering';
import { PlanningModule } from './modules/planning';
import { RealtimeModule } from './modules/realtime';
import { ReceiptModule } from './modules/receipt';
import { SimulationModule } from './modules/simulation';
import { SyncModule } from './modules/sync';
import { WebhooksModule } from './modules/webhooks';
import { BullRootModule, QUEUES } from './queues';

// Every domain module is registered here once, so a module's owner adds providers
// and controllers in its own folder. Boundaries: src/modules/README.md.
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    BullRootModule,
    BullModule.registerQueue(
      { name: QUEUES.allocation },
      { name: QUEUES.notifications },
    ),
    HealthModule,
    IdentityModule,
    AuditModule,
    MasterDataModule,
    OrderingModule,
    FleetModule,
    PlanningModule,
    ForecastingModule,
    LoadingModule,
    ExecutionModule,
    SyncModule,
    ReceiptModule,
    AlertsModule,
    NotificationsModule,
    WebhooksModule,
    RealtimeModule,
    SimulationModule,
  ],
  controllers: [MetricsController],
})
export class AppModule {}
