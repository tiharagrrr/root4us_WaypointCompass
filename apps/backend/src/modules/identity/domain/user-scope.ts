import type { UserRole } from '@waypoint/shared';
import type { FieldError } from '../../../core/errors/domain-errors';

/** What a role and scope change touches: the role and the rows it may reach. */
export interface UserScope {
  role: UserRole;
  depotId: string | null;
  outletId: string | null;
  vehicleId: string | null;
}

type ScopeField = Exclude<keyof UserScope, 'role'>;

/**
 * The scope columns each role reads (specs/identity/spec.md, Model): a
 * dispatcher's depot (none means all depots), a loader's and a driver's
 * depot, a driver's vehicle, a store manager's outlet. Admins have none.
 */
const USES: Record<UserRole, readonly ScopeField[]> = {
  admin: [],
  dispatcher: ['depotId'],
  loader: ['depotId'],
  driver: ['depotId', 'vehicleId'],
  store_manager: ['outletId'],
};

/** Store managers need an outlet and loaders a depot; a dispatcher's depot is optional. */
const REQUIRED: Partial<Record<UserRole, ScopeField>> = {
  store_manager: 'outletId',
  loader: 'depotId',
};

const LABELS: Record<UserRole, string> = {
  admin: 'An admin',
  dispatcher: 'A dispatcher',
  loader: 'A loader',
  driver: 'A driver',
  store_manager: 'A store manager',
};

const NOUNS: Record<ScopeField, string> = {
  depotId: 'depot',
  outletId: 'outlet',
  vehicleId: 'vehicle',
};

const NEEDS: Record<ScopeField, string> = {
  depotId: 'a depot',
  outletId: 'an outlet',
  vehicleId: 'a vehicle',
};

/**
 * The scope after a change: fields the request leaves out keep their value,
 * and fields the new role doesn't read are cleared, so a store manager made
 * dispatcher loses the outlet.
 */
export function nextScope(
  before: UserScope,
  changes: Partial<UserScope>,
): UserScope {
  const role = changes.role ?? before.role;
  // undefined keeps the value; null clears it (a dispatcher back to all depots).
  const keep = (field: ScopeField) =>
    !USES[role].includes(field)
      ? null
      : changes[field] === undefined
        ? before[field]
        : changes[field];
  return {
    role,
    depotId: keep('depotId'),
    outletId: keep('outletId'),
    vehicleId: keep('vehicleId'),
  };
}

/**
 * Why the scope can't be saved: a field the role doesn't read was sent, a
 * required one is missing, or a driver has no verified phone to sign in with.
 */
export function scopeErrors(
  next: UserScope,
  changes: Partial<UserScope>,
  hasVerifiedPhone: boolean,
): FieldError[] {
  const errors: FieldError[] = [];
  for (const field of Object.keys(NOUNS) as ScopeField[]) {
    if (changes[field] != null && !USES[next.role].includes(field))
      errors.push({
        field,
        code: 'not_allowed',
        message: `${LABELS[next.role]} has no ${NOUNS[field]}`,
      });
  }
  const required = REQUIRED[next.role];
  if (required && next[required] == null)
    errors.push({
      field: required,
      code: 'required',
      message: `${LABELS[next.role]} needs ${NEEDS[required]}`,
    });
  if (next.role === 'driver' && !hasVerifiedPhone)
    errors.push({
      field: 'role',
      code: 'phone_required',
      message: 'A driver needs a verified phone number to sign in',
    });
  return errors;
}

export const sameScope = (a: UserScope, b: UserScope): boolean =>
  a.depotId === b.depotId &&
  a.outletId === b.outletId &&
  a.vehicleId === b.vehicleId;
