import { ConfirmReceiptLineDtoCondition, IssueType } from '@compass/api-client'

/** M6's four kinds, in the frame's order. The API also knows LATE and OTHER, which only the driver's D5 raises. */
export const REPORT_TYPES = [IssueType.MISSING, IssueType.DAMAGED, IssueType.SHORT, IssueType.TEMPERATURE] as const
export type ReportType = (typeof REPORT_TYPES)[number]

export const ISSUE_TYPE_WORDS: Record<string, string> = {
  MISSING: 'Missing',
  DAMAGED: 'Damaged',
  SHORT: 'Short',
  TEMPERATURE: 'Temperature',
  LATE: 'Late',
  OTHER: 'Other',
}

/** What M5 stores for a line when the store reports this kind of problem against it. */
export const CONDITION_OF: Record<ReportType, ConfirmReceiptLineDtoCondition> = {
  MISSING: ConfirmReceiptLineDtoCondition.missing,
  DAMAGED: ConfirmReceiptLineDtoCondition.damaged,
  SHORT: ConfirmReceiptLineDtoCondition.short,
  TEMPERATURE: ConfirmReceiptLineDtoCondition.temperature,
}

export const ISSUE_STATUS_WORDS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
}

export const RESOLUTION_WORDS: Record<string, string> = {
  CREDIT_ISSUED: 'Credit issued',
  CREDIT_REQUESTED: 'Credit requested',
  REDELIVERY: 'Re-delivery',
  NO_ACTION: 'No action',
}

/** Missing and short lose packs; damaged and temperature spoil packs that did arrive. */
export const losesPacks = (type: string): boolean => type === 'MISSING' || type === 'SHORT'

/** The chip tone for an issue's status: open is loud, in progress a warning, resolved calm. */
export const issueTone = (status: string) => (status === 'RESOLVED' ? 'success' : status === 'IN_PROGRESS' ? 'warning' : 'danger')
