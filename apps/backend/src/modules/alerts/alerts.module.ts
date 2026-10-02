// apps/backend/src/modules/alerts/alerts.module.ts · owner: Harini
// One action list for the dispatcher, raised from other modules' events.
// Spec: specs/alerts/spec.md. Tables: src/db/schema/alerts.ts.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { AlertsController } from './controllers/alerts.controller';
import { AlertLinks } from './policies/alert.links';
import { AlertScope } from './policies/alert.scope';
import { AlertEventListener } from './services/alert-event.listener';
import { AlertQueries } from './services/alert.queries';
import { AlertsService } from './services/alerts.service';

/**
 * Alerts imports no module but audit, which every module that writes an audit
 * row imports (specs/alerts/spec.md, depends-on). Everything it knows about
 * trips, stops, flags, issues, deferrals and conflicts arrives as an event
 * payload, parsed before it is trusted, which is what lets the module react
 * to nine other modules without depending on any of them.
 *
 * `AlertEventListener` is exported for the outbox relay (ROO-24) to call once
 * it exists; nothing in this build drives it yet.
 */
@Module({
  imports: [AuditModule],
  controllers: [AlertsController],
  providers: [
    AlertEventListener,
    AlertLinks,
    AlertQueries,
    AlertScope,
    AlertsService,
  ],
  exports: [AlertEventListener, AlertQueries],
})
export class AlertsModule {}
