import { describe, expect, it } from 'vitest';
import { USER_ROLES, type UserRole } from '../domain';
import {
  can,
  isPermission,
  PERMISSIONS,
  permissionsOf,
  roles,
  type Permission,
} from './permissions';

const A: UserRole = 'admin';
const D: UserRole = 'dispatcher';
const S: UserRole = 'store_manager';
const L: UserRole = 'loader';
const V: UserRole = 'driver';

/**
 * Who holds each permission, copied from the Permissions tables in
 * specs/<module>/spec.md. Keyed by Permission, so a new permission fails to
 * compile until someone decides who holds it.
 */
const HOLDERS: Record<Permission, UserRole[]> = {
  'user:create': [A],
  'user:list': [A],
  'user:set-role': [A],
  'user:ban': [A],
  'user:impersonate': [],
  'user:impersonate-admins': [],
  'user:delete': [],
  'user:set-password': [A],
  'user:set-email': [A],
  'user:get': [A],
  'user:update': [A],
  'session:list': [A],
  'session:revoke': [A],
  'session:delete': [A],
  'order:read': [A, D, S, L],
  'order:create': [S],
  'order:update': [S],
  'order:submit': [S],
  'order:cancel': [D, S],
  'order:queue': [D],
  'catalog:read': [A, D, S],
  'catalog:manage': [A],
  'plan:read': [A, D],
  'plan:build': [D],
  'plan:publish': [D],
  'plan:revise': [D],
  'plan:close': [D],
  'deferral:read': [A, D, S],
  'deferral:decide': [D],
  'deferral:respond': [S],
  'trip:read': [A, D, L, V],
  'trip:reassign': [D],
  'trip:resequence': [D],
  'load:read': [D, L],
  'load:check': [L],
  'load:flag': [L],
  'load:release': [L],
  'load:decide': [D],
  'stop:read': [D, S, V],
  'stop:record': [V],
  'receipt:read': [D, S],
  'receipt:confirm': [S],
  'issue:read': [D, S],
  'issue:create': [S, V],
  'issue:resolve': [D],
  'alert:read': [D],
  'alert:act': [D],
  'tracking:read': [A, D, S],
  'forecast:read': [A, D],
  'forecast:manage': [A],
  'masterData:read': [A, D, S, L, V],
  'masterData:manage': [A],
  'audit:read': [A, D, S],
  'audit:export': [A, D],
  'settings:read': [A, D],
  'settings:manage': [A],
  'webhook:manage': [A],
  'simulation:run': [A, D],
};

describe('permission matrix', () => {
  it('has a role for every user role and nothing else', () => {
    expect(Object.keys(roles).sort()).toEqual([...USER_ROLES].sort());
  });

  it('lists every permission of the statement once', () => {
    expect(Object.keys(HOLDERS).sort()).toEqual([...PERMISSIONS].sort());
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it.each(PERMISSIONS)('%s is held by exactly the roles in the specs', (permission) => {
    const holders = USER_ROLES.filter((role) => can({ role }, permission));
    expect(holders.sort()).toEqual([...HOLDERS[permission]].sort());
  });

  it('gives a store manager order:submit but not plan:publish', () => {
    expect(permissionsOf('store_manager')).toContain('order:submit');
    expect(permissionsOf('store_manager')).not.toContain('plan:publish');
  });

  it('never lets admin delete or impersonate a user', () => {
    expect(can({ role: 'admin' }, 'user:delete')).toBe(false);
    expect(can({ role: 'admin' }, 'user:impersonate')).toBe(false);
  });

  it('refuses a missing actor and an unknown role', () => {
    expect(can(null, 'masterData:read')).toBe(false);
    expect(can({ role: 'system' }, 'masterData:read')).toBe(false);
    expect(can({ role: 'user' }, 'masterData:read')).toBe(false);
  });

  it('recognises permission strings', () => {
    expect(isPermission('order:submit')).toBe(true);
    expect(isPermission('order:delete')).toBe(false);
    expect(isPermission('any')).toBe(false);
  });
});
