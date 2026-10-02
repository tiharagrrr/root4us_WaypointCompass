import type {
  LoadFlagStatus,
  LoadLineStatus,
  TempClass,
  TripStatus,
} from '../domain';

/**
 * The preconditions a trip must meet before it leaves the dock
 * (specs/loading/spec.md, Model invariants). One pure function, so L4's
 * checklist and `POST /trips/{id}/release` can never disagree about why a
 * release was refused: the API calls it to build both `GET
 * /trips/{id}/release-checks` and the 409's `checks`, and the tablet calls the
 * same function on its cached list to grey the Release button out before
 * anyone taps it.
 *
 * Pure: every fact comes in as a parameter, including the temperature limit
 * (`loading.maxReleaseTempC`, which an admin edits on A6) and the plan's
 * revision. Nothing here reads a clock or a database.
 */

/** The checks, in the order L4 lists them. */
export const RELEASE_CHECKS = [
  'TRIP_STATUS',
  'LINES_RESOLVED',
  'NO_OPEN_FLAG',
  'LATEST_REVISION',
  'DRIVER_ASSIGNED',
  'REEFER_TEMP',
] as const;
export type ReleaseCheckId = (typeof RELEASE_CHECKS)[number];

/** One precondition, as L4 draws it and as the 409 lists it. */
export interface ReleaseCheck {
  id: ReleaseCheckId;
  /** The line L4 shows beside the tick or cross. */
  label: string;
  pass: boolean;
  /** Why it failed, or what it confirmed; always set. */
  detail: string;
}

/** A line's status is resolved when its goods are settled, either way. */
const RESOLVED: readonly LoadLineStatus[] = ['OK', 'REPLACED', 'REMOVED'];

/** A flag still waiting on somebody blocks the release. */
const BLOCKING: readonly LoadFlagStatus[] = ['OPEN', 'AWAITING_RECHECK'];

/** The trip as the checks see it; a subset of the trip resource. */
export interface ReleaseTrip {
  status: TripStatus;
  /** A CHILLED trip carries a reefer and needs a reading; AMBIENT does not. */
  tempClass: TempClass;
  driverId: string | null;
}

export interface ReleaseLine {
  status: LoadLineStatus;
  planRevision: number;
}

export interface ReleaseFlag {
  status: LoadFlagStatus;
}

export interface ReleaseChecksInput {
  trip: ReleaseTrip;
  lines: readonly ReleaseLine[];
  flags: readonly ReleaseFlag[];
  /** The plan's current revision, which the list must match. */
  planRevision: number;
  /** The reefer reading the loader typed, or null when they gave none. */
  reeferTempC?: number | null;
  /** `loading.maxReleaseTempC`, in °C. */
  maxReleaseTempC: number;
  /**
   * The revision the tablet believes it is looking at. When it is given and
   * it is not the plan's, the tablet has not seen the latest plan yet, so the
   * revision check fails even though the server's own lines are current.
   */
  seenRevision?: number | null;
}

/**
 * Each precondition with a pass or a fail and a line of detail. Always
 * returns every check, so L4 can draw the whole list and a refusal can say
 * what is still outstanding rather than only the first problem.
 */
export function releaseChecks(input: ReleaseChecksInput): ReleaseCheck[] {
  const {
    trip,
    lines,
    flags,
    planRevision,
    reeferTempC,
    maxReleaseTempC,
    seenRevision,
  } = input;

  const unresolved = lines.filter((l) => !RESOLVED.includes(l.status)).length;
  const blocking = flags.filter((f) => BLOCKING.includes(f.status)).length;
  const stale = lines.filter((l) => l.planRevision !== planRevision).length;
  const needsReefer = trip.tempClass === 'CHILLED';

  return [
    {
      id: 'TRIP_STATUS',
      label: 'The trip is being loaded',
      pass: trip.status === 'LOADING',
      detail:
        trip.status === 'LOADING'
          ? 'Loading'
          : trip.status === 'RELEASED'
            ? 'This trip has already been released.'
            : `A ${trip.status.toLowerCase().replace('_', ' ')} trip cannot be released.`,
    },
    {
      id: 'LINES_RESOLVED',
      label: 'Every line checked, replaced or removed',
      pass: unresolved === 0,
      detail:
        unresolved === 0
          ? `${lines.length} ${lines.length === 1 ? 'line' : 'lines'} resolved`
          : `${unresolved} ${unresolved === 1 ? 'line is' : 'lines are'} still to check.`,
    },
    {
      id: 'NO_OPEN_FLAG',
      label: 'No flag waiting on anyone',
      pass: blocking === 0,
      detail:
        blocking === 0
          ? 'No open flags'
          : `${blocking} ${blocking === 1 ? 'flag is' : 'flags are'} waiting for the depot.`,
    },
    {
      id: 'LATEST_REVISION',
      label: 'The list matches the latest plan',
      pass:
        stale === 0 && (seenRevision == null || seenRevision === planRevision),
      detail: revisionDetail(stale, planRevision, seenRevision),
    },
    {
      id: 'DRIVER_ASSIGNED',
      label: 'A driver is assigned',
      pass: trip.driverId != null,
      detail:
        trip.driverId != null
          ? 'Driver assigned'
          : 'No driver is assigned to this trip yet.',
    },
    {
      id: 'REEFER_TEMP',
      label: needsReefer
        ? `Reefer at or below ${maxReleaseTempC.toFixed(1)} °C`
        : 'No reefer needed',
      pass: !needsReefer || tempOk(reeferTempC, maxReleaseTempC),
      detail: tempDetail(needsReefer, reeferTempC, maxReleaseTempC),
    },
  ];
}

/** True when the release passes every precondition. */
export const canRelease = (checks: readonly ReleaseCheck[]): boolean =>
  checks.every((check) => check.pass);

/** The checks that failed, which is what a 409 lists. */
export const failedChecks = (checks: readonly ReleaseCheck[]): ReleaseCheck[] =>
  checks.filter((check) => !check.pass);

/**
 * A reading exactly at the limit releases. The spec's limit is "at or below"
 * (AC-LOD-15: 5.0 releases, 5.1 does not), and the reading is rounded to one
 * decimal first, so a float that arrives as 5.000000000000001 is still 5.0.
 */
function tempOk(reeferTempC: number | null | undefined, max: number): boolean {
  if (reeferTempC == null) return false;
  return Math.round(reeferTempC * 10) / 10 <= Math.round(max * 10) / 10;
}

function tempDetail(
  needsReefer: boolean,
  reeferTempC: number | null | undefined,
  max: number,
): string {
  if (!needsReefer) return 'This trip carries no chilled goods.';
  if (reeferTempC == null)
    return 'Read the reefer temperature before you release.';
  return tempOk(reeferTempC, max)
    ? `${reeferTempC.toFixed(1)} °C`
    : `${reeferTempC.toFixed(1)} °C is above the ${max.toFixed(1)} °C limit.`;
}

function revisionDetail(
  stale: number,
  planRevision: number,
  seenRevision: number | null | undefined,
): string {
  if (seenRevision != null && seenRevision !== planRevision)
    return `Your list is at revision ${seenRevision}; the plan is at ${planRevision}. Reload the list.`;
  if (stale > 0)
    return `${stale} ${stale === 1 ? 'line is' : 'lines are'} from an older revision of the plan.`;
  return `Revision ${planRevision}`;
}
