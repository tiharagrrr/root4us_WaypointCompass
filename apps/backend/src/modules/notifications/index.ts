// The notifications module's public surface: other modules import from this file only.
export { NotificationsModule } from './notifications.module';
export {
  NOTIFY_SEND_JOB,
  SEND_ATTEMPTS,
  SEND_BACKOFF_MS,
} from './notifications.constants';
export {
  NotificationDispatcher,
  type SendJob,
} from './services/notification-dispatcher.service';
export {
  NotificationSender,
  ProviderError,
  type SendOutcome,
} from './services/notification-sender.service';
