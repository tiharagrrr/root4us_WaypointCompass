/**
 * Receipt's names, in one place. Events are named for what happened rather than
 * for the module, so consumers (alerts, realtime, webhooks) subscribe by event and
 * the module can change underneath them.
 */
export const RECEIPT_EVENTS = {
  confirmed: 'receipt.confirmed',
  issueReported: 'issue.reported',
  issueCommented: 'issue.commented',
  issueResolved: 'issue.resolved',
  issueReopened: 'issue.reopened',
} as const;

/** The events receipt listens for. */
export const RECEIPT_CONSUMES = {
  stopCompleted: 'stop.completed',
} as const;

/** Audit actions, `<module>.<entity>.<past-tense verb>` (specs/receipt/spec.md, Audit actions). */
export const RECEIPT_AUDIT = {
  confirmed: 'receipt.confirmed',
  reconciled: 'receipt.reconciled',
  issueReported: 'receipt.issue.reported',
  issueCommented: 'receipt.issue.commented',
  issueResolved: 'receipt.issue.resolved',
  issueReopened: 'receipt.issue.reopened',
  issuePhotoAdded: 'receipt.issue.photo_added',
} as const;

export const RECEIPT_LOGS = {
  confirmed: 'receipt.confirmed',
  reconciled: 'receipt.reconciled',
  issueReported: 'receipt.issue.reported',
} as const;

/** A store may reopen a resolved issue for this long after the resolution (AC-RCP-14). */
export const REOPEN_WINDOW_HOURS = 48;

/** A comment is plain text up to this long, with no editing or deleting (AC-RCP-12). */
export const COMMENT_MAX_LENGTH = 1000;

/** The entity type issue threads use in the shared comments table. */
export const ISSUE_COMMENT_ENTITY = 'issue';

/** The owner type issue photos use in the shared attachments table. */
export const ISSUE_PHOTO_OWNER = 'issue';

/** Photos upload through a presigned URL valid for 10 minutes and download for 5 (spec, Non-functional). */
export const PHOTO_UPLOAD_MINUTES = 10;
export const PHOTO_DOWNLOAD_MINUTES = 5;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** What a store records for one line of a delivery. */
export const LINE_CONDITIONS = [
  'ok',
  'damaged',
  'short',
  'missing',
  'temperature',
] as const;
export type LineCondition = (typeof LINE_CONDITIONS)[number];

/** The order statuses from which a store can confirm normally: the driver's record has arrived. */
export const CONFIRMABLE_STATUSES = ['DELIVERED', 'PARTIAL'] as const;
