// The webhooks module's public surface: other modules import from this file only.
export { WebhooksModule } from './webhooks.module';
export {
  EMAIL_RECEIPT_EVENTS,
  type EmailReceiptEvent,
  type EmailReceiptPayload,
} from './webhooks.constants';
export { signSvix } from './inbound/svix';
