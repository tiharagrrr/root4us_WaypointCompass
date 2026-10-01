// apps/backend/src/modules/planning/planning.module.ts · owner: Tihara
// Confirmed orders into trips the dispatcher checks, edits and publishes; owns trip and stop status.
// Spec: specs/planning/spec.md. Tables: src/db/schema/planning.ts.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { DeferralReasonsController } from './controllers/deferral-reasons.controller';
import { DeferralReasonLinks } from './policies/deferral-reason.links';
import { DeferralReasonsService } from './services/deferral-reasons.service';

@Module({
  imports: [AuditModule],
  controllers: [DeferralReasonsController],
  providers: [DeferralReasonsService, DeferralReasonLinks],
  exports: [],
})
export class PlanningModule {}
