// apps/backend/src/modules/planning/planning.module.ts · owner: Tihara
// Confirmed orders into trips the dispatcher checks, edits and publishes; owns trip and stop status.
// Spec: specs/planning/spec.md. Tables: src/db/schema/planning.ts.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { OrderingModule } from '../ordering';
import { DeferralReasonsController } from './controllers/deferral-reasons.controller';
import { DeferralReasonLinks } from './policies/deferral-reason.links';
import { DeferralReasonsService } from './services/deferral-reasons.service';
import { DeferralService } from './services/deferral.service';
import { TripLifecycleService } from './services/trip-lifecycle.service';

@Module({
  imports: [AuditModule, OrderingModule],
  controllers: [DeferralReasonsController],
  providers: [
    DeferralReasonsService,
    DeferralReasonLinks,
    DeferralService,
    TripLifecycleService,
  ],
  // Loading and execution move trip and stop status, and record the
  // deferrals they cause, only through these services (architecture rule 2,
  // AC-PLN-34, AC-LOD-12).
  exports: [DeferralService, TripLifecycleService],
})
export class PlanningModule {}
