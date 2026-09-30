// apps/backend/src/modules/identity/identity.module.ts · owner: Nimesha
// Sign-in for the five roles, scopes, invitations, devices and settings.
// Spec: specs/identity/spec.md. Tables: src/db/schema/identity.ts (settings in platform.ts).
import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { DemoInbox } from '../../core/demo/demo-inbox';
import { type Auth } from './auth/auth';
import { AUTH, IdentityAuthModule } from './auth/auth.module';
import { DemoController } from './controllers/demo.controller';
import { MeController } from './controllers/me.controller';
import { RootController } from './controllers/root.controller';
import { MeLinks } from './policies/me.links';
import { RootLinks } from './policies/root.links';
import { DevicesService } from './services/devices.service';
import { MeService } from './services/me.service';

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
  controllers: [RootController, MeController, DemoController],
  providers: [RootLinks, MeLinks, MeService, DevicesService, DemoInbox],
  exports: [IdentityAuthModule],
})
export class IdentityModule {}
