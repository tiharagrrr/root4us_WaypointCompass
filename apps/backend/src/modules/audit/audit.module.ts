// apps/backend/src/modules/audit/audit.module.ts · owner: Nimesha
// The hash-chained, append-only record of every state change.
// Spec: specs/audit/spec.md. Tables: src/db/schema/audit.ts.
import { Module } from '@nestjs/common';
import { AuditService } from './services/audit.service';

@Module({
  imports: [],
  controllers: [],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
