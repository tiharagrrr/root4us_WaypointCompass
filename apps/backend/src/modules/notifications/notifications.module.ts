// apps/backend/src/modules/notifications/notifications.module.ts · owner: Nimesha
// Domain events into in-app, email, SMS and push messages, exactly once.
// Spec: specs/notifications/spec.md. Tables: src/db/schema/notifications.ts.
import { BullModule } from '@nestjs/bullmq';
import { Module, type OnModuleInit } from '@nestjs/common';
import { DemoInbox } from '../../core/demo/demo-inbox';
import { EventBus } from '../../core/outbox/event-bus';
import { ProvidersModule } from '../../core/providers/providers.module';
import { QUEUES } from '../../queues';
import { AuditModule } from '../audit';
import { RealtimeModule } from '../realtime';
import { MyNotificationsController } from './controllers/my-notifications.controller';
import { NotificationPreferencesController } from './controllers/notification-preferences.controller';
import { NotificationPreviewController } from './controllers/notification-preview.controller';
import { consumes } from './domain/catalog';
import { NotificationLinks } from './policies/notification.links';
import { NotificationScope } from './policies/notification.scope';
import { NotificationDispatcher } from './services/notification-dispatcher.service';
import { NotificationSender } from './services/notification-sender.service';
import { NotificationQueries } from './services/notification.queries';
import { NotificationsService } from './services/notifications.service';
import { PreferencesService } from './services/preferences.service';
import { OutboundProviders } from './services/providers';
import { ReceiptsService, consumesReceipt } from './services/receipts.service';
import { RecipientsService } from './services/recipients.service';

/**
 * The dispatcher is registered on the EventBus, so the outbox relay hands it
 * every event the catalog names, inside that event's transaction. The sender
 * runs in the worker's notify.send job (src/worker/notifications.processor.ts).
 */
@Module({
  imports: [
    AuditModule,
    // PresenceService: no push to someone with the app open (AC-NTF-12).
    RealtimeModule,
    // SMS_PROVIDER: the gateway SMS_PROVIDER names (core/providers).
    ProvidersModule,
    BullModule.registerQueue({ name: QUEUES.notifications }),
  ],
  controllers: [
    MyNotificationsController,
    NotificationPreferencesController,
    NotificationPreviewController,
  ],
  providers: [
    DemoInbox,
    NotificationDispatcher,
    NotificationLinks,
    NotificationQueries,
    NotificationScope,
    NotificationSender,
    NotificationsService,
    OutboundProviders,
    PreferencesService,
    ReceiptsService,
    RecipientsService,
  ],
  exports: [NotificationDispatcher, NotificationSender],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly dispatcher: NotificationDispatcher,
    private readonly receipts: ReceiptsService,
  ) {}

  onModuleInit(): void {
    this.bus.register({
      name: 'notifications',
      consumes,
      handle: (event) => this.dispatcher.handle(event),
    });
    // Provider receipts (AC-NTF-08), from the webhooks gateway.
    this.bus.register({
      name: 'notifications-receipts',
      consumes: consumesReceipt,
      handle: (event) => this.receipts.handle(event),
    });
  }
}
