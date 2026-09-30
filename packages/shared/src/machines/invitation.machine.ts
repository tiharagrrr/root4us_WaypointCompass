import type { InvitationStatus } from '../domain';
import { defineMachine } from './machine';

export type InvitationEvent = 'ACCEPT' | 'EXPIRE' | 'RESEND' | 'REVOKE';

/** Tokens are single-use and last 72 hours; RESEND issues a new token and expiry. */
export const invitationMachine = defineMachine<
  InvitationStatus,
  InvitationEvent
>('invitation', {
  PENDING: {
    ACCEPT: 'ACCEPTED',
    EXPIRE: 'EXPIRED',
    RESEND: 'PENDING',
    REVOKE: 'REVOKED',
  },
  EXPIRED: { RESEND: 'PENDING', REVOKE: 'REVOKED' },
  ACCEPTED: {},
  REVOKED: {},
});
