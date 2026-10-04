// apps/backend/src/modules/audit/audit.module.ts · owner: Nimesha
// The hash-chained, append-only record of every state change.
// Spec: specs/audit/spec.md. Tables: src/db/schema/audit.ts.
import { Module } from '@nestjs/common';
import { TimelinesController } from './controllers/timelines.controller';
import { OrderTimelineScope } from './policies/timeline.scope';
import { AuditService } from './services/audit.service';
import { TimelineService } from './services/timeline.service';

@Module({
  imports: [],
  controllers: [TimelinesController],
  providers: [AuditService, OrderTimelineScope, TimelineService],
  exports: [AuditService],
})
export class AuditModule {}
