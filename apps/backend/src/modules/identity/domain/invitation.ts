import { createHash, randomBytes } from 'node:crypto';
import type { InvitationStatus, UserRole } from '@waypoint/shared';
import type { FieldError } from '../../../core/errors/domain-errors';
import { scopeErrors, type UserScope } from './user-scope';

/** Invitation links last 72 hours of real time. */
export const INVITATION_TTL_MS = 72 * 3_600_000;

/** 32 random bytes for the link; it goes out once and is never stored. */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** Only this hash of a link's token is stored, so the database can't open an invitation. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * The status as people see it. A PENDING invitation past its expiry reads as
 * EXPIRED at once; nothing has to write that first. `now` is real time
 * (ClockService.realNow()), never the demo clock.
 */
export function effectiveStatus(
  invitation: { status: InvitationStatus; expiresAt: Date },
  now: Date,
): InvitationStatus {
  return invitation.status === 'PENDING' &&
    invitation.expiresAt.getTime() <= now.getTime()
    ? 'EXPIRED'
    : invitation.status;
}

/** Roles that sign in with email and password, so they are invited by email. */
const EMAIL_ROLES: readonly UserRole[] = [
  'admin',
  'dispatcher',
  'store_manager',
];

export interface InvitationDraft {
  role: UserRole;
  email?: string | null;
  phoneNumber?: string | null;
  depotId?: string | null;
  outletId?: string | null;
  vehicleId?: string | null;
}

/**
 * Why an invitation can't be sent (AC-IDN-41): email roles need an email,
 * drivers a phone for the SMS, loaders either; the scope follows the role
 * exactly as it does for a role change.
 */
export function invitationErrors(draft: InvitationDraft): FieldError[] {
  const errors: FieldError[] = [];
  if (EMAIL_ROLES.includes(draft.role) && !draft.email)
    errors.push({
      field: 'email',
      code: 'required',
      message: 'This role is invited by email',
    });
  if (draft.role === 'driver' && !draft.phoneNumber)
    errors.push({
      field: 'phoneNumber',
      code: 'required',
      message: 'A driver is invited by SMS',
    });
  if (draft.role === 'loader' && !draft.email && !draft.phoneNumber)
    errors.push({
      field: 'email',
      code: 'required',
      message: 'A loader needs an email or a phone number',
    });
  const scope: UserScope = {
    role: draft.role,
    depotId: draft.depotId ?? null,
    outletId: draft.outletId ?? null,
    vehicleId: draft.vehicleId ?? null,
  };
  // The driver's phone is checked above; it is verified when they accept.
  return [...errors, ...scopeErrors(scope, scope, true)];
}

/** Drivers, and loaders invited by phone, get an SMS; everyone else an email. */
export function channelOf(invitation: {
  role: string;
  email: string | null;
}): 'sms' | 'email' {
  return invitation.role === 'driver' ||
    (invitation.role === 'loader' && !invitation.email)
    ? 'sms'
    : 'email';
}

export type Credential = 'email' | 'password' | 'phoneNumber' | 'code' | 'pin';

/**
 * What an invitee sends to accept: the invited email and a password; a
 * driver the invited phone and the SMS code; a loader the invited email or
 * phone and the PIN they will use at the dock.
 */
export function credentialsFor(invitation: {
  role: string;
  email: string | null;
}): Credential[] {
  if (invitation.role === 'driver') return ['phoneNumber', 'code'];
  if (invitation.role === 'loader')
    return [invitation.email ? 'email' : 'phoneNumber', 'pin'];
  return ['email', 'password'];
}
