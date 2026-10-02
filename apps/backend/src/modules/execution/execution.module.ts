// apps/backend/src/modules/execution/execution.module.ts · owner: Aniqa
// The driver's offline trip, append-only stop events, tracking and ETAs.
// Spec: specs/execution/spec.md. Tables: src/db/schema/execution.ts.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { OrderingModule } from '../ordering';
import { PlanningModule } from '../planning';
import { AttachmentsController } from './controllers/attachments.controller';
import { MyTripsController } from './controllers/my-trips.controller';
import { StopsController } from './controllers/stops.controller';
import { TripsController } from './controllers/trips.controller';
import { StopLinks } from './policies/stop.links';
import { TripLinks } from './policies/trip.links';
import { StopScope, TripScope } from './policies/trip.scope';
import { MyTripsQueries } from './services/my-trips.queries';
import { OfflineBundleService } from './services/offline-bundle.service';
import { PodService } from './services/pod.service';
import { StopEventService } from './services/stop-event.service';
import { StopQueries } from './services/stop.queries';

const providers = [
  MyTripsQueries,
  OfflineBundleService,
  PodService,
  StopEventService,
  StopLinks,
  StopQueries,
  StopScope,
  TripLinks,
  TripScope,
];

@Module({
  // Trip and stop status move through planning's TripLifecycleService, and
  // order status through ordering's OrderLifecycleService (rule 2).
  imports: [AuditModule, OrderingModule, PlanningModule],
  controllers: [
    MyTripsController,
    TripsController,
    StopsController,
    AttachmentsController,
  ],
  providers,
  // Sync replays the driver's queued events through the same handler (ROO-44).
  exports: [StopEventService, MyTripsQueries, OfflineBundleService],
})
export class ExecutionModule {}
