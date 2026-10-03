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

/** 23's Store column, in the dispatcher's words; a priority request is the one that needs them. */
export const STORE_CHIP: Record<string, { label: string; tone: 'neutral' | 'danger' }> = {
  AWAITING: { label: 'Awaiting', tone: 'neutral' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'neutral' },
  PRIORITY_REQUESTED: { label: 'Priority asked', tone: 'danger' },
}

/** 23's panel eyebrow: what the store did with the deferral. */
export const PANEL_EYEBROW: Record<string, string> = {
  AWAITING: 'Awaiting the store',
  ACKNOWLEDGED: 'Acknowledged',
  PRIORITY_REQUESTED: 'Priority request',
}

/** The periods 23's header offers, in days back from today. */
export const PERIODS = [7, 14, 30] as const
export type Period = (typeof PERIODS)[number]

/** "Tihara Egodage" as 23's Logged by column prints it: "T. Egodage". */
export function shortName(name: string | null | undefined): string {
  if (!name) return 'Engine'
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name
}

/** The outlet's name without its brand word: the glyph beside it already says Fresh, Style or Tech. */
export function placeName(outletName: string): string {
  return outletName.replace(/^(Fresh|Style|Tech)\s+/i, '')
}
