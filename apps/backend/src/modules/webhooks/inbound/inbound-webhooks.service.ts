import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { uuidv7 } from 'uuidv7';
import { ClockService } from '../../../core/clock/clock.service';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { inboundWebhookEvents } from '../../../db/schema';
import { AuditService } from '../../audit';
import {
  EMAIL_RECEIPT_EVENTS,
  type EmailReceiptPayload,
  WEBHOOK_AUDIT,
  WEBHOOK_LOGS,
} from '../webhooks.constants';
import { type SvixHeaders, verifySvix } from './svix';

export type Receipt = 'accepted' | 'duplicate' | 'ignored' | 'rejected';

interface ResendEvent {
  type?: unknown;
  data?: { email_id?: unknown };
}

/**
 * The inbound gateway for Resend (specs/webhooks): check the signature, keep
 * the event exactly once by its svix-id, and turn a delivery receipt into an
 * outbox event for notifications, which owns the rows it moves (AC-NTF-08).
 * A bad signature is still stored, with signatureOk false, so an attack or a
 * wrong secret shows up in the table; the caller then answers 401.
 */
@Injectable()
export class InboundWebhooksService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly config: ConfigService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(InboundWebhooksService.name);
  }

  /** False when no webhook secret is configured: the route then answers 404. */
  get resendEnabled(): boolean {
    return Boolean(this.config.get<string>('RESEND_WEBHOOK_SECRET'));
  }

  @Transactional()
  async receiveResend(
    headers: SvixHeaders & Record<string, unknown>,
    body: Buffer,
  ): Promise<Receipt> {
    const secret = this.config.getOrThrow<string>('RESEND_WEBHOOK_SECRET');
    // Svix timestamps are wall-clock time, never the demo clock.
    const check = verifySvix(secret, headers, body, this.clock.realNow());
    const payload = parse(body);
    const eventType = typeof payload.type === 'string' ? payload.type : null;
    const kept = {
      svixId: headers.id,
      svixTimestamp: headers.timestamp,
      userAgent: headers['user-agent'],
    };

    const [row] = await this.txHost.tx
      .insert(inboundWebhookEvents)
      .values({
        provider: 'resend',
        // A rejected call may carry no id, or reuse a genuine one: never let it block the real event.
        externalId: check.ok ? check.id : `rejected:${uuidv7()}`,
        eventType,
        signatureOk: check.ok,
        headers: kept,
        payload,
        status: check.ok ? 'received' : 'failed',
        error: check.ok ? null : check.reason,
      })
      .onConflictDoNothing()
      .returning({ id: inboundWebhookEvents.id });

    if (!check.ok) {
      this.log.warn(
        {
          event: WEBHOOK_LOGS.rejected,
          provider: 'resend',
          reason: check.reason,
        },
        'webhook signature rejected',
      );
      return 'rejected';
    }
    if (!row) {
      this.log.info(
        {
          event: WEBHOOK_LOGS.duplicate,
          provider: 'resend',
          externalId: check.id,
        },
        'webhook already received',
      );
      return 'duplicate';
    }

    const receipt =
      eventType && eventType in EMAIL_RECEIPT_EVENTS
        ? EMAIL_RECEIPT_EVENTS[eventType as keyof typeof EMAIL_RECEIPT_EVENTS]
        : null;
    const emailId = payload.data?.email_id;
    const handled = receipt !== null && typeof emailId === 'string';
    if (handled) {
      await this.outbox.add(
        receipt,
        {
          v: 1,
          provider: 'resend',
          providerMessageId: emailId,
          inboundId: row.id,
        } satisfies EmailReceiptPayload,
        { aggregate: ['inbound_webhook', row.id] },
      );
      await this.audit.record({
        action: WEBHOOK_AUDIT.received,
        entity: ['inbound_webhook', row.id],
        after: { provider: 'resend', eventType, providerMessageId: emailId },
        source: 'WEBHOOK',
      });
    }
    await this.txHost.tx
      .update(inboundWebhookEvents)
      .set({
        status: handled ? 'processed' : 'ignored',
        processedAt: this.clock.realNow(),
      })
      .where(eq(inboundWebhookEvents.id, row.id));
    this.log.info(
      { event: WEBHOOK_LOGS.received, provider: 'resend', eventType, handled },
      'webhook received',
    );
    return handled ? 'accepted' : 'ignored';
  }
}

function parse(body: Buffer): ResendEvent & Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(body.toString('utf8'));
    return typeof value === 'object' && value !== null
      ? (value as ResendEvent & Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
