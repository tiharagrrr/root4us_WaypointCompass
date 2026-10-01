// The identity module's public surface: other modules import from this file only.
export { IdentityModule } from './identity.module';
export {
  AUTH_INVITE_JOB,
  AUTH_OTP_JOB,
  type AuthInviteJob,
  type AuthOtpJob,
} from './auth/auth-messages';
export {
  IDENTITY_EVENTS,
  type UserAccessChangedEvent,
} from './events/identity.events';
