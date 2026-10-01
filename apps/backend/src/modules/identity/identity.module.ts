// apps/backend/src/modules/identity/identity.module.ts · owner: Nimesha
// Sign-in for the five roles, scopes, invitations, devices and settings.
// Spec: specs/identity/spec.md. Tables: src/db/schema/identity.ts (settings in platform.ts).
import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { DemoInbox } from '../../core/demo/demo-inbox';
import { AuditModule } from '../audit';
import { type Auth } from './auth/auth';
import { AUTH, IdentityAuthModule } from './auth/auth.module';
import { ClockController } from './controllers/clock.controller';
import { DemoController } from './controllers/demo.controller';
import { DevicesController } from './controllers/devices.controller';
import { InvitationsController } from './controllers/invitations.controller';
import { MeController } from './controllers/me.controller';
import { RootController } from './controllers/root.controller';
import { SettingsController } from './controllers/settings.controller';
import { UsersController } from './controllers/users.controller';
import {
  DeviceScope,
  InvitationScope,
  UserScope,
} from './policies/admin.scope';
import { DeviceLinks } from './policies/device.links';
import { InvitationLinks } from './policies/invitation.links';
import { MeLinks } from './policies/me.links';
import { RootLinks } from './policies/root.links';
import { SettingLinks } from './policies/setting.links';
import { UserLinks } from './policies/user.links';
import { DemoCommands } from './services/demo.commands';
import { DemoQueries } from './services/demo.queries';
import { DeviceQueries } from './services/device.queries';
import { DevicesService } from './services/devices.service';
import { DockService } from './services/dock.service';
import { InvitationQueries } from './services/invitation.queries';
import { InvitationsService } from './services/invitations.service';
import { MeService } from './services/me.service';
import { PinService } from './services/pin.service';
import { ReferenceChecks } from './services/reference-checks';
import { ScopeDirectory } from './services/scope-directory';
import { SettingsCommands } from './services/settings.commands';
import { UserQueries } from './services/user.queries';
import { UsersService } from './services/users.service';

@Module({
  imports: [
    AuditModule,
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
  controllers: [
    RootController,
    MeController,
    DemoController,
    UsersController,
    InvitationsController,
    DevicesController,
    SettingsController,
    ClockController,
  ],
  providers: [
    RootLinks,
    MeLinks,
    MeService,
    DevicesService,
    DemoInbox,
    UserScope,
    UserQueries,
    UsersService,
    PinService,
    ReferenceChecks,
    ScopeDirectory,
    UserLinks,
    InvitationScope,
    InvitationQueries,
    InvitationsService,
    InvitationLinks,
    DeviceScope,
    DeviceQueries,
    DockService,
    DeviceLinks,
    SettingsCommands,
    SettingLinks,
    DemoCommands,
    DemoQueries,
  ],
  exports: [IdentityAuthModule],
})
export class IdentityModule {}
