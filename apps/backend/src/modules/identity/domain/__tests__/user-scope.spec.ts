import { nextScope, scopeErrors, type UserScope } from '../user-scope';

const loader: UserScope = {
  role: 'loader',
  depotId: 'PLG',
  outletId: null,
  vehicleId: null,
};

describe('nextScope', () => {
  it('keeps the depot when a loader becomes a dispatcher', () => {
    expect(nextScope(loader, { role: 'dispatcher' })).toEqual({
      role: 'dispatcher',
      depotId: 'PLG',
      outletId: null,
      vehicleId: null,
    });
  });

  it('clears a field sent as null, and keeps one left out', () => {
    expect(nextScope(loader, { role: 'dispatcher', depotId: null })).toEqual({
      ...loader,
      role: 'dispatcher',
      depotId: null,
    });
    expect(nextScope(loader, {}).depotId).toBe('PLG');
  });

  it('drops the scope the new role does not read', () => {
    const manager: UserScope = {
      ...loader,
      role: 'store_manager',
      depotId: null,
      outletId: 'OUT014',
    };
    expect(nextScope(manager, { role: 'admin' })).toEqual({
      role: 'admin',
      depotId: null,
      outletId: null,
      vehicleId: null,
    });
  });
});

describe('scopeErrors', () => {
  it('names a required field the role is missing', () => {
    const next = nextScope(loader, { role: 'store_manager' });
    expect(scopeErrors(next, { role: 'store_manager' }, false)).toEqual([
      {
        field: 'outletId',
        code: 'required',
        message: 'A store manager needs an outlet',
      },
    ]);
  });

  it('refuses a field the role does not read', () => {
    const changes = { role: 'dispatcher' as const, outletId: 'OUT014' };
    expect(
      scopeErrors(nextScope(loader, changes), changes, false).map(
        (e) => e.field,
      ),
    ).toEqual(['outletId']);
  });

  it('needs a verified phone for a driver', () => {
    const changes = { role: 'driver' as const };
    const next = nextScope(loader, changes);
    expect(scopeErrors(next, changes, false).map((e) => e.code)).toEqual([
      'phone_required',
    ]);
    expect(scopeErrors(next, changes, true)).toEqual([]);
  });
});
