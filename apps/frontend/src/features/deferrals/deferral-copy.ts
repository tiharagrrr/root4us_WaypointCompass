/** What the store's answer reads as once it is given (M4, M7). */
export const RESPONSE_WORDS: Record<string, string> = {
  ACKNOWLEDGED: 'You acknowledged it',
  PRIORITY_REQUESTED: 'You asked for priority',
}

/** The Your response chip on M7. */
export const RESPONSE_CHIP: Record<string, string> = {
  AWAITING: 'Acknowledge',
  ACKNOWLEDGED: 'Acknowledged',
  PRIORITY_REQUESTED: 'Priority asked',
}
