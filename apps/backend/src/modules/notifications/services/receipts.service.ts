import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, inArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { notificationPreferences, notifications } from '../../../db/schema';
import { AuditService } from '../../audit';
import { EMAIL_RECEIPT_EVENTS, type EmailReceiptPayload } from '../../webhooks';
import {
  ALL_EVENTS,
  NOTIFICATION_AUDIT,
  NOTIFICATION_LOGS,
} from '../notifications.constants';

/** Every channel but email: what a bounced or complaining address is left with. */
const WITHOUT_EMAIL = ['IN_APP', 'SMS', 'PUSH'] as const;

export const consumesReceipt = (type: string): boolean =>
  type in EMAIL_RECEIPT_EVENTS;

/**
 * A provider's receipt moves the row it is about (AC-NTF-08): delivered sets
 * DELIVERED; a bounce or a complaint sets FAILED and switches the person's
 * email off for every event, through a `*` preference row, so the address is
 * never written to again until they turn it back on.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(ReceiptsService.name);
  }

  @Transactional()
  async handle(event: DeliveredEvent): Promise<'moved' | 'unknown'> {
    const payload = event.payload as Partial<EmailReceiptPayload>;
    if (typeof payload.providerMessageId !== 'string') return 'unknown';
    const tx = this.txHost.tx;
    const [row] = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.providerMessageId, payload.providerMessageId));
    if (!row) return 'unknown';

    if (event.type === EMAIL_RECEIPT_EVENTS['email.delivered']) {
      // A late "delivered" never overrides a bounce or a read.
      await tx
        .update(notifications)
        .set({ status: 'DELIVERED', deliveredAt: this.clock.now() })
        .where(
          and(
            eq(notifications.id, row.id),
            inArray(notifications.status, ['QUEUED', 'SENT']),
          ),
        );
      return 'moved';
    }

    const why =
      event.type === EMAIL_RECEIPT_EVENTS['email.bounced']
        ? 'bounced'
        : 'complained';
    await tx
      .update(notifications)
      .set({ status: 'FAILED', error: `Email ${why}` })
      .where(eq(notifications.id, row.id));
    await tx
      .insert(notificationPreferences)
      .values({
        userId: row.userId,
        eventType: ALL_EVENTS,
        channels: [...WITHOUT_EMAIL],
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.eventType,
        ],
        set: { channels: [...WITHOUT_EMAIL] },
      });
    await this.audit.record({
      action: NOTIFICATION_AUDIT.emailSuppressed,
      entity: ['user', row.userId],
      after: { reason: why, notificationId: row.id },
      source: 'WEBHOOK',
    });
    this.log.warn(
      {
        event: NOTIFICATION_LOGS.emailSuppressed,
        notificationId: row.id,
        reason: why,
      },
      'email switched off after a provider receipt',
    );
    return 'moved';
  }
}
