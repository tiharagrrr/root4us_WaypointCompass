import { describe, expect, it } from 'vitest';
import { EngineInputError } from '../../errors';
import { editOpSchema, parseEdits } from '../edit-ops';

const ALL = [
  { op: 'ADD_TRIP', vehicleId: 'v1', tripNo: 1, brand: 'FRESH', districtId: 'd1' },
  { op: 'REMOVE_TRIP', tripKey: 'REF-07#1' },
  { op: 'ASSIGN_ORDER', orderId: 'o1', tripKey: 'REF-07#1' },
  { op: 'ASSIGN_ORDER', orderId: 'o2', tripKey: 'REF-07#1', position: 0 },
  { op: 'UNASSIGN_ORDER', orderId: 'o1' },
  { op: 'MOVE_ORDER', orderId: 'o1', tripKey: 'REF-03#1' },
  { op: 'RESEQUENCE', tripKey: 'REF-07#1', orderIds: ['o2', 'o1'] },
];

function failure(raw: unknown): EngineInputError {
  try {
    parseEdits(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(EngineInputError);
    return e as EngineInputError;
  }
  throw new Error('expected parseEdits to throw');
}

describe('EditOp', () => {
  it('edit-ops: all six operations parse, with and without a position', () => {
    expect(parseEdits(ALL)).toEqual(ALL);
    for (const op of ALL) expect(editOpSchema.safeParse(op).success).toBe(true);
  });

  it('edit-ops: an operation the schema does not know is refused, naming its position', () => {
    const e = failure([ALL[1], { op: 'TELEPORT_ORDER', orderId: 'o1' }]);
    expect(e).toMatchObject({ code: 'INVALID_EDIT', field: 'edits[1].op', value: 'TELEPORT_ORDER' });
  });

  it('edit-ops: a missing field is refused, naming the field', () => {
    const e = failure([{ op: 'ASSIGN_ORDER', orderId: 'o1' }]);
    expect(e).toMatchObject({ code: 'INVALID_EDIT', field: 'edits[0].tripKey' });
  });

  it('edit-ops: an extra field is refused so a typo cannot be ignored', () => {
    const e = failure([{ op: 'REMOVE_TRIP', tripKey: 'REF-07#1', tripkey: 'x' }]);
    expect(e.code).toBe('INVALID_EDIT');
    expect(e.field).toBe('edits[0]');
  });

  it('edit-ops: a bad position or trip number is refused', () => {
    expect(failure([{ op: 'ASSIGN_ORDER', orderId: 'o1', tripKey: 't', position: -1 }]).field).toBe('edits[0].position');
    expect(failure([{ op: 'ADD_TRIP', vehicleId: 'v', tripNo: 1.5, brand: 'FRESH', districtId: 'd' }]).field).toBe('edits[0].tripNo');
    expect(failure([{ op: 'ADD_TRIP', vehicleId: 'v', tripNo: 1, brand: 'FROZEN', districtId: 'd' }]).field).toBe('edits[0].brand');
  });

  it('edit-ops: something that is not a list is refused', () => {
    expect(failure({ op: 'REMOVE_TRIP' })).toMatchObject({ code: 'INVALID_EDIT', field: 'edits' });
  });
});
