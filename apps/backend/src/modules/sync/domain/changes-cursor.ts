import { ValidationError } from '../../../core/errors/domain-errors';
import {
  decodeCursor,
  encodeCursor,
} from '../../../core/persistence/list-query';

/** The feed's one sort: oldest change first, the order a device must apply them in. */
const SORT = 'occurredAt';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sorts before every real id, so a cursor made from a time alone skips nothing at that time. */
const FIRST_ID = '00000000-0000-0000-0000-000000000000';

/** Where a device has read up to: the last change's time, to the millisecond, and its id. */
export interface ChangesPosition {
  at: Date;
  id: string;
}

/** The position as the opaque `since` a device hands back (specs/api-conventions.md, cursors). */
export function encodeSince(position: ChangesPosition): string {
  return encodeCursor({
    k: position.at.toISOString(),
    id: position.id,
    s: SORT,
  });
}

/** A cursor for "everything from this instant on", for a device with nothing to read yet. */
export const sinceInstant = (at: Date): string =>
  encodeSince({ at, id: FIRST_ID });

/**
 * Reads a `since` back. Anything that is not a cursor this feed issued (not base64url JSON,
 * another feed's sort, a time or an id that does not parse) answers 400 VALIDATION_FAILED on
 * `since`, never a 500 from the database.
 */
export function decodeSince(raw: string): ChangesPosition {
  const bad = new ValidationError([
    {
      field: 'since',
      code: 'invalid',
      message: 'This cursor is not valid here. Start again without it.',
    },
  ]);
  let cursor: ReturnType<typeof decodeCursor>;
  try {
    cursor = decodeCursor(raw, SORT);
  } catch (err) {
    if (err instanceof ValidationError) throw bad;
    throw err;
  }
  if (typeof cursor.k !== 'string' || !UUID.test(cursor.id)) throw bad;
  const at = new Date(cursor.k);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== cursor.k) throw bad;
  return { at, id: cursor.id };
}
