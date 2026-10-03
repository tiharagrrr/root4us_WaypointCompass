import type { LoadFlagDto, LoadFlagDtoReason, LoadLineDtoStatus, LoadTripDtoTempClass, LoadTripSummaryDtoStatus } from '@compass/api-client'
import type { StatusTone } from '@/ui/status-chip'

/**
 * The dock's words, taken from the L-frames. Statuses arrive from the API in capitals and the chip
 * shows them as they are (L2's rail reads LOADING, NOT STARTED, RELEASED), so only the ones the
 * frame writes differently are mapped here.
 */
export const TRIP_STATUS_LABEL: Partial<Record<LoadTripSummaryDtoStatus, string>> = {
  PLANNED: 'NOT STARTED',
}

export const tripStatusLabel = (status: LoadTripSummaryDtoStatus): string =>
  TRIP_STATUS_LABEL[status] ?? status.replace(/_/g, ' ')

export const tripStatusTone = (status: LoadTripSummaryDtoStatus): StatusTone => {
  if (status === 'LOADING') return 'info'
  if (status === 'RELEASED') return 'success'
  return 'muted'
}

/**
 * The depot's two words for a trip's temperature class: a chilled trip is a Fresh run and an
 * ambient one a Dry run, which is how the frames and the vehicle codes (REF-07, DRY-22) read.
 */
export const tempClassLabel = (tempClass: LoadTripDtoTempClass): string =>
  tempClass === 'CHILLED' ? 'Fresh' : 'Dry'

/** L3's reason cards, in the frame's order and its words. */
export const FLAG_REASONS: readonly { value: LoadFlagDtoReason; label: string }[] = [
  { value: 'MISSING', label: 'Missing' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'WRONG_TEMP', label: 'Wrong temperature' },
  { value: 'OVER_CAPACITY', label: 'Won’t fit' },
]

export const flagReasonLabel = (reason: LoadFlagDtoReason): string =>
  FLAG_REASONS.find((option) => option.value === reason)?.label ?? reason

/** A line is settled when nothing more is owed on it before release (AC-LOD-16). */
export const isSettled = (status: LoadLineDtoStatus): boolean =>
  status === 'OK' || status === 'REPLACED' || status === 'REMOVED'

/** The flag the dock is still dealing with, if any: the newest one not yet resolved. */
export const liveFlag = (flags: readonly LoadFlagDto[]): LoadFlagDto | undefined =>
  [...flags].reverse().find((flag) => flag.status !== 'RESOLVED')

/**
 * The newest flag on a line whatever its state. L3c's banner is about a flag that is finished with,
 * so the dock is told it cleared rather than left to notice the red going away.
 */
export const latestFlag = (flags: readonly LoadFlagDto[]): LoadFlagDto | undefined => flags[flags.length - 1]
