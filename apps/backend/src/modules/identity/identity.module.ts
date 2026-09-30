// apps/backend/src/modules/identity/identity.module.ts · owner: Nimesha
// Sign-in for the five roles, scopes, invitations, devices and settings.
// Spec: specs/identity/spec.md. Tables: src/db/schema/identity.ts (settings in platform.ts).
import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { type Auth } from './auth/auth';
import { AUTH, IdentityAuthModule } from './auth/auth.module';

@Module({
  imports: [
    IdentityAuthModule,
    AuthModule.forRootAsync({
      imports: [IdentityAuthModule],
      inject: [AUTH],
      useFactory: (auth: Auth) => ({
        auth,
        // One origin behind Caddy: no CORS.
        disableTrustedOriginsCors: true,
      }),
      // CoreModule runs BetterAuth's AuthGuard first in its own ordered chain.
      disableGlobalAuthGuard: true,
    }),
  ],
  controllers: [],
  providers: [],
  exports: [IdentityAuthModule],
})
export class IdentityModule {}
