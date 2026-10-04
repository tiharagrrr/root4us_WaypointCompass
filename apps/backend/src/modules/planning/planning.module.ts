// apps/backend/src/modules/planning/planning.module.ts · owner: Tihara
// Confirmed orders into trips the dispatcher checks, edits and publishes; owns trip and stop status.
// Spec: specs/planning/spec.md. Tables: src/db/schema/planning.ts.
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../../queues';
import { FleetModule } from '../fleet';
import { MasterDataModule } from '../master-data';
import { AuditModule } from '../audit';
import { OrderingModule } from '../ordering';
import { DeferralReasonsController } from './controllers/deferral-reasons.controller';
import { DeferralsController } from './controllers/deferrals.controller';
import { PlanBuildingController } from './controllers/plan-building.controller';
import { PlansController } from './controllers/plans.controller';
import { DeferralReasonLinks } from './policies/deferral-reason.links';
import { DeferralLinks } from './policies/deferral.links';
import { DeferralScope } from './policies/deferral.scope';
import { DeferralActions } from './services/deferral-actions.service';
import { DeferralQueries } from './services/deferral.queries';
import { DeferralReasonsService } from './services/deferral-reasons.service';
import { PlanLinks } from './policies/plan.links';
import { PlanScope } from './policies/plan.scope';
import { DeferralDecisions } from './services/deferral-decisions.service';
import { DeferralService } from './services/deferral.service';
import { EngineRunner } from './services/engine-runner.service';
import { PlanContextBuilder } from './services/plan-context.builder';
import { PlanEngine } from './services/plan-engine';
import { PlanWriter } from './services/plan-writer';
import { PlanQueries } from './services/plan.queries';
import { PlanViews } from './services/plan.views';
import { DayCloseService } from './services/day-close.service';
import { PlansService } from './services/plans.service';
import { PublishPolicy } from './services/publish.policy';
import { TripLifecycleService } from './services/trip-lifecycle.service';

@Module({
  imports: [
    AuditModule,
    OrderingModule,
    FleetModule,
    MasterDataModule,
    BullModule.registerQueue({ name: QUEUES.allocation }),
  ],
  controllers: [
    DeferralReasonsController,
    PlansController,
    PlanBuildingController,
    DeferralsController,
  ],
  providers: [
    DeferralReasonsService,
    DeferralReasonLinks,
    DeferralService,
    DeferralScope,
    DeferralLinks,
    DeferralQueries,
    DeferralActions,
    TripLifecycleService,
    PlanScope,
    PlanLinks,
    PlanContextBuilder,
    PlanEngine,
    PlanWriter,
    PlanViews,
    PlanQueries,
    PublishPolicy,
    PlansService,
    DayCloseService,
    DeferralDecisions,
    EngineRunner,
  ],
  // Loading and execution move trip and stop status, and record the
  // deferrals they cause, only through these services (architecture rule 2,
  // AC-PLN-34, AC-LOD-12).
  exports: [DeferralService, TripLifecycleService, EngineRunner],
})
export class PlanningModule {}
