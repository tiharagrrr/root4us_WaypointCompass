import type { ReleaseCheck } from '@waypoint/shared';
import {
  StateConflictError,
  ValidationError,
} from '../../../core/errors/domain-errors';

/**
 * A release that failed its preconditions (AC-LOD-14, AC-LOD-15).
 *
 * The spec's Open questions left the problem code and the field open. This
 * is `CONFLICT_STATE` with a `checks` member, because:
 *
 * - it is a 409, not a 422: nothing about the request is wrong, the dock is
 *   simply not finished, and the same body sent two minutes later succeeds;
 * - it carries **every** check, not only the failures, so L4 can draw the
 *   same checklist from the refusal that `GET /trips/{id}/release-checks`
 *   gives it, and the tablet never has to merge two shapes;
 * - a missing reefer reading is a failing check rather than a 400, which is
 *   what AC-LOD-15 asks for ("each attempt answers 409 with the temperature
 *   check failing"). A loader who has not read the thermometer yet is in the
 *   same position as one with a line still to check.
 */
export class ReleaseBlockedError extends StateConflictError {
  constructor(readonly checks: readonly ReleaseCheck[]) {
    super(detailOf(checks));
  }

  extensions() {
    return {
      checks: this.checks,
      failedChecks: this.checks.filter((check) => !check.pass).map((c) => c.id),
    };
  }
}

/** The failing checks as one sentence, for a client that shows only `detail`. */
function detailOf(checks: readonly ReleaseCheck[]): string {
  const failed = checks.filter((check) => !check.pass);
  if (failed.length === 0) return 'This trip cannot be released yet.'; // Defensive; never thrown on a pass.
  return `This trip cannot be released yet: ${failed
    .map((check) => check.detail)
    .join(' ')}`;
}

/** One field is wrong, named the way the dock's screens expect. */
export const fieldError = (field: string, code: string, message: string) =>
  new ValidationError([{ field, code, message }]);

/**
 * A reason is required to decide a flag REMOVE (AC-LOD-08). The message is
 * the one the spec quotes, so the dialog can show the server's words.
 */
export const reasonRequired = () =>
  fieldError('reasonCode', 'required', 'A reason is required');
