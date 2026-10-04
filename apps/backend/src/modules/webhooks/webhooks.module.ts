// apps/backend/src/modules/webhooks/webhooks.module.ts · owner: Nimesha
// Verified inbound provider callbacks and signed outbound webhooks.
// Spec: specs/webhooks/spec.md. Tables: src/db/schema/webhooks.ts.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { InboundWebhooksController } from './controllers/inbound-webhooks.controller';
import { InboundWebhooksService } from './inbound/inbound-webhooks.service';

/**
 * Inbound so far: Resend's delivery receipts become email.* outbox events,
 * which notifications consumes. Outbound endpoints and the other providers
 * are ROO-36.
 */
@Module({
  imports: [AuditModule],
  controllers: [InboundWebhooksController],
  providers: [InboundWebhooksService],
  exports: [],
})
export class WebhooksModule {}
