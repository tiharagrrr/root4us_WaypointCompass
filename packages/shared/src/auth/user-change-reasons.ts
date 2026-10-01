/**
 * Why an admin changed someone's role or scope on A1. PATCH /users/{id}
 * requires one, and it becomes the audit row's reasonCode
 * (identity.user.role_changed, identity.user.scope_changed).
 */
export const USER_CHANGE_REASONS = [
  "TRANSFER",
  "PROMOTION",
  "CORRECTION",
  "OFFBOARDING",
  "OTHER",
] as const;
export type UserChangeReason = (typeof USER_CHANGE_REASONS)[number];
