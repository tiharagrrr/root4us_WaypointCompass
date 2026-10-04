/**
 * What a provider's email receipt becomes on the outbox. Notifications
 * consumes these (it owns the rows they move); webhooks never imports it.
 */
export const EMAIL_RECEIPT_EVENTS = {
  'email.delivered': 'email.delivered',
  'email.bounced': 'email.bounced',
  'email.complained': 'email.complained',
} as const;

export type EmailReceiptEvent =
  (typeof EMAIL_RECEIPT_EVENTS)[keyof typeof EMAIL_RECEIPT_EVENTS];

/** The payload every email receipt event carries. */
export interface EmailReceiptPayload {
  v: 1;
  provider: 'resend';
  /** The provider's message id: Notification.providerMessageId. */
  providerMessageId: string;
  inboundId: string;
}

export const WEBHOOK_AUDIT = {
  received: 'webhooks.inbound.received',
} as const;

export const WEBHOOK_LOGS = {
  received: 'webhooks.inbound.received',
  duplicate: 'webhooks.inbound.duplicate',
  rejected: 'webhooks.inbound.rejected',
} as const;
