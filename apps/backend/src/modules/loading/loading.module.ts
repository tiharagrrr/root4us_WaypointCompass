// apps/backend/src/modules/loading/loading.module.ts · owner: Harini
// Last-stop-first load lists, checks, flags and release.
// Spec: specs/loading/spec.md. Tables: src/db/schema/loading.ts.
import { Module, type OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../core/outbox/event-bus';
import { AuditModule } from '../audit';
import { OrderingModule } from '../ordering';
import { PlanningModule } from '../planning';
import { LoadFlagsController } from './controllers/load-flags.controller';
import { LoadLinesController } from './controllers/load-lines.controller';
import { LoadingBoardController } from './controllers/loading-board.controller';
import { TripLoadingController } from './controllers/trip-loading.controller';
import { LoadFlagLinks } from './policies/load-flag.links';
import { LoadListLinks } from './policies/load-list.links';
import { LoadScope } from './policies/load.scope';
import { LoadCheckService } from './services/load-check.service';
import { LoadFlagService } from './services/load-flag.service';
import { LoadListBuilder } from './services/load-list-builder.service';
import { LoaderEventService } from './services/loader-event.service';
import { LoadingQueries } from './services/loading.queries';
import { ReleaseService } from './services/release.service';

/**
 * Loading imports audit, planning and ordering (specs/loading/spec.md,
 * depends-on), and nothing else:
 *
 * - **planning** for `TripLifecycleService`, the one way a trip's status
 *   moves, and `DeferralService`, the one way the deferral a REMOVE causes
 *   is recorded (architecture rule 2);
 * - **ordering** for `OrderLifecycleService`, which marks the trip's orders
 *   LOADED on release and raises the backorder a REMOVE leaves behind.
 *
 * Everything else it needs to know — that a plan was published, that a trip
 * was reassigned — arrives as an event payload, parsed before it is trusted,
 * which is what keeps the dock from depending on the planning API.
 *
 * `LoadListBuilder` is registered on the `EventBus`, so the outbox relay
 * (ROO-24) delivers it `plan.published`, `plan.revised` and
 * `trip.reassigned`; `LoaderEventService` is exported for `POST /sync`
 * (ROO-44).
 */
@Module({
  imports: [AuditModule, PlanningModule, OrderingModule],
  controllers: [
    LoadingBoardController,
    TripLoadingController,
    LoadFlagsController,
    LoadLinesController,
  ],
  providers: [
    LoadCheckService,
    LoadFlagLinks,
    LoadFlagService,
    LoadListBuilder,
    LoadListLinks,
    LoadScope,
    LoaderEventService,
    LoadingQueries,
    ReleaseService,
  ],
  exports: [LoadListBuilder, LoaderEventService, LoadingQueries],
})
export class LoadingModule implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly builder: LoadListBuilder,
  ) {}

  onModuleInit(): void {
    this.bus.register({
      name: 'loading',
      consumes: (type) => LoadListBuilder.consumes(type),
      handle: (event) => this.builder.handle(event),
    });
  }
}
