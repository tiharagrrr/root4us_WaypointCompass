import { BRANDS } from '@waypoint/shared/domain';
import { z } from 'zod';
import { EngineInputError } from '../errors';

const text = z.string().min(1);
const position = z.number().int().min(0);

/**
 * The edits a dispatcher can make to a plan by hand. Trips are named by key ("REF-07#1"). SET_DRIVER
 * and SET_WAVE are plan data the engine knows nothing about; the API adds them to this union.
 */
export const editOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('ADD_TRIP'),
    vehicleId: text,
    tripNo: z.number().int().positive(),
    brand: z.enum(BRANDS),
    districtId: text,
  }),
  z.strictObject({ op: z.literal('REMOVE_TRIP'), tripKey: text }),
  z.strictObject({ op: z.literal('ASSIGN_ORDER'), orderId: text, tripKey: text, position: position.optional() }),
  z.strictObject({ op: z.literal('UNASSIGN_ORDER'), orderId: text }),
  z.strictObject({ op: z.literal('MOVE_ORDER'), orderId: text, tripKey: text, position: position.optional() }),
  z.strictObject({ op: z.literal('RESEQUENCE'), tripKey: text, orderIds: z.array(text) }),
]);

export type EditOp = z.infer<typeof editOpSchema>;

const editsSchema = z.array(editOpSchema);

function valueAt(raw: unknown, path: readonly PropertyKey[]): string {
  let cursor: unknown = raw;
  for (const key of path) {
    if (cursor === null || typeof cursor !== 'object') return String(cursor);
    cursor = (cursor as Record<PropertyKey, unknown>)[key];
  }
  return typeof cursor === 'object' && cursor !== null ? JSON.stringify(cursor) : String(cursor);
}

/** "edits[1].tripKey" from a zod path of [1, "tripKey"]. */
function fieldOf(path: readonly PropertyKey[]): string {
  return path.reduce<string>((field, key) => (typeof key === 'number' ? `${field}[${key}]` : `${field}.${String(key)}`), 'edits');
}

/**
 * Checks a list of edits that came from outside (a request body, a form) and names the first thing
 * wrong with it: the position in the list, the field, the value and why. Throws INVALID_EDIT.
 */
export function parseEdits(raw: unknown): EditOp[] {
  const parsed = editsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue?.path ?? [];
  throw new EngineInputError({
    code: 'INVALID_EDIT',
    field: fieldOf(path),
    value: valueAt(raw, path),
    reason: `is not a valid edit: ${issue?.message ?? 'invalid'}`,
    cause: parsed.error,
  });
}
