import {
  PreconditionRequiredError,
  ValidationError,
} from '../../core/errors/domain-errors';

/**
 * An `If-Match: W/"<version>"` header where it is optional for some callers. A store
 * manager reporting an issue must send it (428 when missing); a driver, who does not
 * hold the order's version on the phone, may leave it out. A malformed header is a 400
 * for everyone, the same as the `@IfMatch()` decorator.
 */
export function parseOptionalIfMatch(
  raw: string | undefined,
  required: boolean,
): number | undefined {
  if (!raw) {
    if (required) throw new PreconditionRequiredError();
    return undefined;
  }
  const match = /^W\/"(\d{1,9})"$/.exec(raw.trim());
  if (!match)
    throw new ValidationError([
      {
        field: 'If-Match',
        code: 'format',
        message: 'Expected W/"<version>", as sent in the ETag header.',
      },
    ]);
  return Number(match[1]);
}
