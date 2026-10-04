/** The worker job that sends one EMAIL, SMS or PUSH row. */
export const NOTIFY_SEND_JOB = 'notify.send';

/** A send that throws is retried after these delays, then the row is FAILED (AC-NTF-06). */
export const SEND_BACKOFF_MS = [30_000, 120_000, 600_000] as const;
export const SEND_ATTEMPTS = SEND_BACKOFF_MS.length + 1;

export const NOTIFICATION_EVENTS = {
  /** An in-app row for one user: the 02 bell refetches (AC-NTF-13). */
  created: 'notification.created',
  /** Read on one device: the user's other tabs clear the badge. */
  read: 'notification.read',
} as const;

export const NOTIFICATION_AUDIT = {
  read: 'notifications.notification.read',
  allRead: 'notifications.notification.all_read',
} as const;

export const NOTIFICATION_LOGS = {
  dispatched: 'notifications.event.dispatched',
  sent: 'notifications.notification.sent',
  retrying: 'notifications.notification.retrying',
  failed: 'notifications.notification.failed',
  suppressed: 'notifications.notification.suppressed',
  read: 'notifications.notification.read',
} as const;
