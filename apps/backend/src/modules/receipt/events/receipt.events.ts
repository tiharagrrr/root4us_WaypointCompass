import type {
  IssueResolution,
  IssueType,
  ReceiptStatus,
} from '@waypoint/shared';

/**
 * Payloads carry ids, numbers and statuses only, never names, photos or comment
 * bodies (webhook subscribers take these, specs/receipt/spec.md, Events).
 */

/** receipt.confirmed: the store said what arrived. */
export type ReceiptConfirmedEvent = {
  v: 1;
  receiptId: string;
  orderId: string;
  outletId: string;
  status: ReceiptStatus;
  issues: number;
  awaitingDriverSync: boolean;
};

/**
 * issue.reported. The field names are the ones alerts parses to raise STORE_ISSUE
 * (`issueReportedPayload`), so a change here is a change there.
 */
export type IssueReportedEvent = {
  v: 1;
  issueId: string;
  type: IssueType;
  outletId: string;
  orderId?: string;
  stopId?: string;
  raisedById?: string;
  qtyAffected: number | null;
};

export type IssueCommentedEvent = {
  v: 1;
  issueId: string;
  commentId: string;
  outletId: string;
  orderId?: string;
};

/** issue.resolved clears the STORE_ISSUE alert by its issue id. */
export type IssueResolvedEvent = {
  v: 1;
  issueId: string;
  outletId: string;
  orderId?: string;
  resolution: IssueResolution;
};

export type IssueReopenedEvent = {
  v: 1;
  issueId: string;
  outletId: string;
  orderId?: string;
};

export type ReceiptEvent =
  | ReceiptConfirmedEvent
  | IssueReportedEvent
  | IssueCommentedEvent
  | IssueResolvedEvent
  | IssueReopenedEvent;
