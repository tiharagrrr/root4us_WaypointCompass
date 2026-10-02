import { describe, expect, it } from 'vitest';
import {
  canRelease,
  failedChecks,
  releaseChecks,
  type ReleaseCheckId,
  type ReleaseChecksInput,
} from './release-checks';

/**
 * The pure half of AC-LOD-14, 15 and 16. The e2e suite checks the same rules
 * through `GET /trips/{id}/release-checks` and `POST /trips/{id}/release`;
 * these run the matrix the endpoint would take minutes to cover, and they are
 * what the tablet relies on when it greys the Release button out offline.
 */

/** A trip that passes every check: chilled, driven, fully checked, current. */
const passing: ReleaseChecksInput = {
  trip: { status: 'LOADING', tempClass: 'CHILLED', driverId: 'u_aniqa' },
  lines: [
    { status: 'OK', planRevision: 1 },
    { status: 'REPLACED', planRevision: 1 },
    { status: 'REMOVED', planRevision: 1 },
  ],
  flags: [{ status: 'RESOLVED' }],
  planRevision: 1,
  reeferTempC: 3.4,
  maxReleaseTempC: 5,
};

const failing = (input: ReleaseChecksInput): ReleaseCheckId[] =>
  failedChecks(releaseChecks(input)).map((check) => check.id);

describe('releaseChecks', () => {
  it('passes every check for a loaded chilled trip with a cold reefer', () => {
    const checks = releaseChecks(passing);
    expect(checks).toHaveLength(6);
    expect(canRelease(checks)).toBe(true);
    expect(failedChecks(checks)).toEqual([]);
  });

  it('always returns every check, so L4 can draw the whole list', () => {
    const ids = releaseChecks({
      ...passing,
      trip: { status: 'PLANNED', tempClass: 'AMBIENT', driverId: null },
      lines: [],
      flags: [],
    }).map((check) => check.id);
    expect(ids).toEqual([
      'TRIP_STATUS',
      'LINES_RESOLVED',
      'NO_OPEN_FLAG',
      'LATEST_REVISION',
      'DRIVER_ASSIGNED',
      'REEFER_TEMP',
    ]);
  });

  it('fails the line check while anything is PENDING or FLAGGED', () => {
    expect(
      failing({
        ...passing,
        lines: [
          { status: 'OK', planRevision: 1 },
          { status: 'PENDING', planRevision: 1 },
        ],
      }),
    ).toEqual(['LINES_RESOLVED']);
    expect(
      failing({
        ...passing,
        lines: [{ status: 'FLAGGED', planRevision: 1 }],
      }),
    ).toEqual(['LINES_RESOLVED']);
  });

  it('fails while a flag is open or awaiting a re-check (AC-LOD-14)', () => {
    expect(failing({ ...passing, flags: [{ status: 'OPEN' }] })).toEqual([
      'NO_OPEN_FLAG',
    ]);
    expect(
      failing({ ...passing, flags: [{ status: 'AWAITING_RECHECK' }] }),
    ).toEqual(['NO_OPEN_FLAG']);
  });

  it('fails the revision check for a stale line or a stale tablet (AC-LOD-13)', () => {
    expect(
      failing({
        ...passing,
        planRevision: 2,
        lines: [{ status: 'OK', planRevision: 1 }],
      }),
    ).toEqual(['LATEST_REVISION']);
    // The server's lines are current; the tablet says it is still on 1.
    expect(failing({ ...passing, seenRevision: 0 })).toEqual([
      'LATEST_REVISION',
    ]);
    expect(failing({ ...passing, seenRevision: 1 })).toEqual([]);
  });

  it('fails without a driver (AC-LOD-14)', () => {
    expect(
      failing({ ...passing, trip: { ...passing.trip, driverId: null } }),
    ).toEqual(['DRIVER_ASSIGNED']);
  });

  it('needs a reading at or below the limit on a chilled trip (AC-LOD-15)', () => {
    expect(failing({ ...passing, reeferTempC: null })).toEqual(['REEFER_TEMP']);
    expect(failing({ ...passing, reeferTempC: 5.1 })).toEqual(['REEFER_TEMP']);
    // Exactly the limit releases.
    expect(failing({ ...passing, reeferTempC: 5 })).toEqual([]);
    expect(failing({ ...passing, reeferTempC: -18 })).toEqual([]);
  });

  it('reads the limit from the setting, not from a constant', () => {
    expect(
      failing({ ...passing, reeferTempC: 3.4, maxReleaseTempC: 2 }),
    ).toEqual(['REEFER_TEMP']);
  });

  it('asks an ambient trip for no temperature at all', () => {
    expect(
      failing({
        ...passing,
        trip: { ...passing.trip, tempClass: 'AMBIENT' },
        reeferTempC: null,
      }),
    ).toEqual([]);
  });

  it('lists every failing check at once, not just the first', () => {
    expect(
      failing({
        ...passing,
        trip: { status: 'PLANNED', tempClass: 'CHILLED', driverId: null },
        lines: [{ status: 'PENDING', planRevision: 0 }],
        flags: [{ status: 'OPEN' }],
        reeferTempC: null,
      }),
    ).toEqual([
      'TRIP_STATUS',
      'LINES_RESOLVED',
      'NO_OPEN_FLAG',
      'LATEST_REVISION',
      'DRIVER_ASSIGNED',
      'REEFER_TEMP',
    ]);
  });

  it('refuses a trip that is already released (AC-LOD-16)', () => {
    expect(
      failing({ ...passing, trip: { ...passing.trip, status: 'RELEASED' } }),
    ).toEqual(['TRIP_STATUS']);
  });

  it('gives every check a detail line, pass or fail', () => {
    for (const check of releaseChecks({ ...passing, reeferTempC: null }))
      expect(check.detail.length).toBeGreaterThan(0);
  });

  it('releases a trip with no lines left to check', () => {
    expect(failing({ ...passing, lines: [], flags: [] })).toEqual([]);
  });
});
