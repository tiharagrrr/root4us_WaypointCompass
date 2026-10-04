/**
 * Clock times on A3 and A4 are integer minutes after midnight, the form the
 * engine uses (`windowOpenMin: 360` is 06:00). The API sends a label beside
 * every minute, so a screen only ever parses on the way back in.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** 360 reads as "06:00"; null stays empty, for a window a depot has not set. */
export const minuteLabel = (min: number | null | undefined): string =>
  min == null ? '' : `${pad(Math.floor(min / 60))}:${pad(min % 60)}`

/** "06:00" becomes 360; anything else is null, so the field can say so. */
export function parseMinute(draft: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(draft.trim())
  if (!match) return null
  const [hours, minutes] = [Number(match[1]), Number(match[2])]
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export const MINUTE_HINT = 'HH:MM, in Colombo time'
