import type { UserRole } from '@waypoint/shared';

/**
 * Identity's outbox events. Payloads carry ids and the few fields consumers
 * need: never names, emails, phone numbers, PINs or tokens. They route by
 * the aggregate; a userId in the payload says whose client to reach.
 */
export const IDENTITY_EVENTS = {
  userRoleChanged: 'identity.user.role_changed',
  userScopeChanged: 'identity.user.scope_changed',
  userDeactivated: 'identity.user.deactivated',
  userReactivated: 'identity.user.reactivated',
  userPinSet: 'identity.user.pin_set',
  userInvited: 'identity.user.invited',
  userJoined: 'identity.user.joined',
  invitationRevoked: 'identity.invitation.revoked',
  deviceDockChanged: 'identity.device.dock_changed',
} as const;

/** role_changed and scope_changed: the user's sessions are gone; realtime refreshes /me. */
export type UserAccessChangedEvent = {
  v: 1;
  userId: string;
  role: UserRole;
  depotId: string | null;
  outletId: string | null;
};

/** deactivated, reactivated and pin_set. */
export type UserEvent = { v: 1; userId: string };

/** An invitation was sent, first time or again. */
export type UserInvitedEvent = {
  v: 1;
  invitationId: string;
  role: UserRole;
  channel: 'sms' | 'email';
  resend: boolean;
};

/** An invitation was accepted and the account exists (notifications: welcome). */
export type UserJoinedEvent = {
  v: 1;
  userId: string;
  invitationId: string;
  role: UserRole;
};

export type InvitationRevokedEvent = { v: 1; invitationId: string };

/** A device became, or stopped being, a dock device for a depot. */
export type DeviceDockChangedEvent = {
  v: 1;
  deviceId: string;
  isDockDevice: boolean;
  depotId: string | null;
};
