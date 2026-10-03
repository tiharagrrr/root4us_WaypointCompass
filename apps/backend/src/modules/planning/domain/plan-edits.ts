import { editOpSchema, type EditOp } from '@waypoint/engine';
import { z } from 'zod';
import { ValidationError } from '../../../core/errors/domain-errors';

const tripKey = z.string().min(1);

/** Plan data the engine knows nothing about, applied by the API after the engine's edits. */
const metaOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('SET_DRIVER'),
    tripKey,
    driverId: z.string().min(1).nullable(),
  }),
  z.strictObject({
    op: z.literal('SET_WAVE'),
    tripKey,
    waveId: z.string().uuid().nullable(),
  }),
]);

export type MetaOp = z.infer<typeof metaOpSchema>;
export type PlanEditOp = EditOp | MetaOp;

const planEditOpSchema = z.union([editOpSchema, metaOpSchema]);

export interface ParsedEdits {
  /** What the engine applies and validates. */
  engine: EditOp[];
  /** Driver and wave changes, applied to the saved trips by key. */
  meta: MetaOp[];
}

/**
 * Parses an edit list from a request body (specs/api-conventions.md, section
 * 8: unions are zod, not classes). An op the union does not know is 400
 * VALIDATION_FAILED naming its position (AC-PLN-13).
 */
export function parsePlanEdits(raw: readonly unknown[]): ParsedEdits {
  const engine: EditOp[] = [];
  const meta: MetaOp[] = [];
  raw.forEach((item, i) => {
    const parsed = planEditOpSchema.safeParse(item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = [`ops[${i}]`, ...(issue?.path ?? []).map(String)].join('.');
      throw new ValidationError([
        {
          field: path,
          code: 'invalid_edit',
          message: `Not a valid edit: ${issue?.message ?? 'unknown op'}`,
        },
      ]);
    }
    const op = parsed.data;
    if (op.op === 'SET_DRIVER' || op.op === 'SET_WAVE') meta.push(op);
    else engine.push(op);
  });
  return { engine, meta };
}
