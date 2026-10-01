/**
 * The permission matrix: which role may do what. The API's PermissionGuard,
 * the link builders and the web app all read this one object, and BetterAuth's
 * admin plugin is configured with the same `ac` and `roles`.
 *
 * A permission is `<resource>:<action>`; `@RequirePermission('plan:publish')`
 * checks `roles[actor.role].authorize({ plan: ['publish'] })`. A role decides
 * what someone may do; which rows they may touch is the ScopePolicy's job.
 * Source: the Permissions section of each specs/<module>/spec.md.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";
import { USER_ROLES, type UserRole } from "../domain";

export const statement = {
  // user:* and session:* are BetterAuth's, used by its admin plugin.
  ...defaultStatements,
  order: ["read", "create", "update", "submit", "cancel", "queue"],
  catalog: ["read", "manage"],
  plan: ["read", "build", "publish", "revise", "close"],
  deferral: ["read", "decide", "respond"],
  trip: ["read", "reassign", "resequence"],
  load: ["read", "check", "flag", "release", "decide"],
  stop: ["read", "record"],
  receipt: ["read", "confirm"],
  issue: ["read", "create", "resolve"],
  alert: ["read", "act"],
  tracking: ["read"],
  forecast: ["read", "manage"],
  masterData: ["read", "manage"],
  audit: ["read", "export"],
  settings: ["read", "manage"],
  webhook: ["manage"],
  simulation: ["run"],
} as const;

type Statement = typeof statement;
export type Resource = keyof Statement;
export type Permission = {
  [R in Resource]: `${R}:${Statement[R][number]}`;
}[Resource];
type RoleStatements = { [R in Resource]?: Statement[R][number][] };

export const ac = createAccessControl(statement);

const roleStatements = {
  // BetterAuth's adminAc without user:delete and user:impersonate: users are
  // never deleted (audit rows point at them), and nobody acts as someone else.
  admin: {
    user: ["create", "list", "set-role", "ban", "set-password", "set-email", "get", "update"],
    session: ["list", "revoke", "delete"],
    order: ["read"],
    catalog: ["read", "manage"],
    plan: ["read"],
    trip: ["read"],
    tracking: ["read"],
    forecast: ["read", "manage"],
    masterData: ["read", "manage"],
    audit: ["read", "export"],
    settings: ["read", "manage"],
    // A6 edits the deferral reason list, so admin reads it too.
    deferral: ["read"],
    webhook: ["manage"],
    simulation: ["run"],
  },
  dispatcher: {
    order: ["read", "queue", "cancel"],
    catalog: ["read"],
    plan: ["read", "build", "publish", "revise", "close"],
    deferral: ["read", "decide"],
    trip: ["read", "reassign", "resequence"],
    load: ["read", "decide"],
    stop: ["read"],
    receipt: ["read"],
    issue: ["read", "resolve"],
    alert: ["read", "act"],
    tracking: ["read"],
    forecast: ["read"],
    masterData: ["read"],
    audit: ["read", "export"],
    settings: ["read"],
    simulation: ["run"],
  },
  store_manager: {
    order: ["read", "create", "update", "submit", "cancel"],
    catalog: ["read"],
    deferral: ["read", "respond"],
    stop: ["read"],
    receipt: ["read", "confirm"],
    issue: ["read", "create"],
    tracking: ["read"],
    masterData: ["read"],
    audit: ["read"],
  },
  loader: {
    order: ["read"],
    trip: ["read"],
    load: ["read", "check", "flag", "release"],
    masterData: ["read"],
  },
  driver: {
    trip: ["read"],
    stop: ["read", "record"],
    issue: ["create"],
    masterData: ["read"],
  },
} satisfies Record<UserRole, RoleStatements>;

export const roles = {
  admin: ac.newRole(roleStatements.admin),
  dispatcher: ac.newRole(roleStatements.dispatcher),
  store_manager: ac.newRole(roleStatements.store_manager),
  loader: ac.newRole(roleStatements.loader),
  driver: ac.newRole(roleStatements.driver),
} satisfies Record<UserRole, unknown>;

/** Every permission in the statement, in statement order. */
export const PERMISSIONS = Object.entries(statement).flatMap(([resource, actions]) =>
  actions.map((action) => `${resource}:${action}`),
) as Permission[];

export function isUserRole(role: unknown): role is UserRole {
  return typeof role === "string" && (USER_ROLES as readonly string[]).includes(role);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as string[]).includes(value);
}

/** Splits `order:submit` into its resource and action. */
export function parsePermission(permission: Permission): [Resource, string] {
  const i = permission.indexOf(":");
  return [permission.slice(0, i) as Resource, permission.slice(i + 1)];
}

/** Whether a signed-in actor's role holds the permission. Scope is checked separately. */
export function can(actor: { role: string } | null | undefined, permission: Permission): boolean {
  if (!actor || !isUserRole(actor.role)) return false;
  const [resource, action] = parsePermission(permission);
  return roles[actor.role].authorize({ [resource]: [action] }).success;
}

/** The permissions a role holds, for /me and the web app's menus. */
export function permissionsOf(role: UserRole): Permission[] {
  return PERMISSIONS.filter((p) => can({ role }, p));
}
