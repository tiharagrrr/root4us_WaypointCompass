---
module: identity
owner: Nimesha
status: in-progress    # draft | ready | in-progress | done
screens: [A0, A1, A2, A6, D0a, D0b, L1, L1m, D12, D13]
depends-on: [core, audit]
---

# Identity, access and admin settings

## Purpose
Identity decides who someone is and what they may touch. It signs five kinds of people in on the right
device, keeps who-can-do-what in one permission matrix, and gives the admin screens A0–A6 their APIs for
users, invitations, devices, settings, deferral reasons, the demo clock and the demo tools.

A role says what someone can do and a scope says which rows they can touch. The server checks both on
every request; the UI only reflects them.

## Scope
In:
- BetterAuth inside the API (`apps/backend/src/modules/identity/auth/auth.ts`) with sessions in Postgres and
  the plugins username, admin, phoneNumber, the custom `loaderPin`, and bearer (off until Flutter).
- The persona accounts and a dock tablet per depot (`src/db/seed-users.ts`, run by `pnpm db:seed`).
- Sign-in for all five roles: email or username and password (A0), phone and SMS code (D0a, D0b), depot
  and dock PIN (L1, L1m); sign-out (D13, Switch user).
- The API root `GET /` with each role's landing links; `/me` and the caller's devices.
- Users (A1): list, role and scope changes with session revocation, deactivate and reactivate, loader PIN.
- Invitations (A1, A2): create, resend, revoke, the invite landing, accept.
- Dock devices; guards and policies (`ActorGuard`, `PermissionGuard`, the `ScopePolicy` base class,
  `can(actor, permission)`); the permission matrix in `packages/shared/src/auth/permissions.ts`.
- The admin API for core services on A6: settings (`SettingsService`), the demo clock (`ClockService`),
  deferral reasons, demo reset and the demo inbox (`DemoService`).

Out:
- Audit trail, feed, export, timelines and chain verification: audit (`specs/audit/spec.md`).
- Sending invitations, sign-in codes, password resets and welcome messages: notifications (Step 7). The
  provider calls run only in worker jobs.
- Pushing `/me` refreshes, clock and settings changes to clients: realtime.
- A3 Outlets, A4 Depots, A5 Vehicles: admin screens in this slice, but their endpoints and criteria live in
  `specs/master-data/spec.md` and `specs/fleet/spec.md`.
- The webhooks card on A6 (`/webhook-endpoints`): webhooks.
- The `deferral_reasons` table: planning owns it (`planning.ts`); only its A6 endpoint is listed here.
- Each module's own `ScopePolicy` subclass (for example `OrderScope`): that module.
- Pausing the offline outbox on 401 and replaying it after sign-in: sync and the web offline layer.
- Reference data the personas point at (depots, outlets, vehicles): the master-data seed.

### Screens
| Frame | Node | Route | Data | Actions and states |
| --- | --- | --- | --- | --- |
| A0 Sign in | 185:8713 | /sign-in | /api/auth/sign-in/email | Wrong password, rate-limited, forgot password |
| A1 Users | 185:8751 | /admin/users | GET /users, GET /invitations | Invite, change role or scope with a reason, deactivate, resend or revoke an invitation; filter by role and depot; pagination |
| A2 Invite user | 185:9045 | Dialog on A1 | POST /invitations | Fields change with the role: outlet for stores, depot for loaders and dispatchers, phone and vehicle for drivers |
| A6 Settings | 185:10227 | /admin/settings | /settings, /deferral-reasons, /clock, /devices/{id}/dock, /webhook-endpoints | Demo time travel, deferral reasons, dock tablets, webhooks |
| D0a Sign in | 244:828 | /sign-in/driver | /api/auth/phone-number/send-otp | Phone in +94 format |
| D0b Enter code | 244:937 | /sign-in/driver | /api/auth/phone-number/verify | Resend after 60 seconds; in the demo the code is in /demo/inbox |
| L1 Sign in | 185:19312 | /sign-in/dock | /api/auth/sign-in/pin | Depot and PIN keypad; wrong PIN; not a dock device |
| L1m Sign in | 254:1243 | /sign-in/dock | Same as L1 | Phone layout |
| D12 Account | 246:874 | /driver/account | GET, PATCH /me, devices | Language, notifications |
| D13 Sign out | 246:1034 | Dialog | Outbox check, then sign out | Waits until everything has synced |

Other routes: `/invite/:token` (invite landing) and `/demo/inbox` (plain page, demo mode only).

## Model
Schema file: `apps/backend/src/db/schema/identity.ts` (owner identity). BetterAuth's four core tables plus the
admin, username and phoneNumber plugin fields, then Waypoint's scope columns, invitations and devices.

| Table | Key columns | Notes |
| --- | --- | --- |
| users | id (text PK), name, email (unique), emailVerified, role (text, default store_manager), banned, banReason, banExpires, username (unique), displayUsername, phoneNumber (unique), phoneNumberVerified, depotId → depots, outletId → outlets, defaultVehicleId → vehicles, pinHash, locale (default en), createdAt, updatedAt | Index users_role_depot_idx (role, depotId). Drivers get `<id>@drivers.waypoint.local` as email. depotId: dispatcher (null = all depots), loader, driver. outletId: store manager. |
| loader_depots | userId → users, depotId → depots; primary key (userId, depotId) | The depots a loader may pick on L1 besides users.depotId (their home depot). Index on depotId. |
| sessions | id, token (unique), userId → users (cascade), expiresAt, ipAddress, userAgent, impersonatedBy | Index on userId |
| accounts | id, accountId, providerId ("credential" for email and password), userId → users (cascade), password, token columns | Index on userId |
| verifications | id, identifier (phone for OTP, email for resets), value, expiresAt | Index on identifier |
| invitations | id (UUIDv7), name, email, phoneNumber, role, depotId, outletId, vehicleId, tokenHash (unique), status, expiresAt, sentAt, acceptedAt, userId (unique, set on accept), invitedById → users, createdAt | status is invitation_status: PENDING, ACCEPTED, EXPIRED, REVOKED (default PENDING). Index (status, expiresAt). |
| devices | id (text, generated on the device, kept in IndexedDB), userId → users, platform (WEB, PWA, FLUTTER), label, isDockDevice (default false), depotId, userAgent, appVersion, pushEndpoint (unique), pushP256dh, pushAuth, fcmToken (unique), lastSeenAt, lastSyncAt, createdAt | Only dock devices may use PIN sign-in |

The `settings` table lives in `apps/backend/src/db/schema/platform.ts` (owner core) and is listed because its
admin API is specified here: key, scope ("global" or a depot id for an override), value (jsonb),
updatedById, updatedAt; primary key (key, scope).

Invariants:
- Roles are a text column (admin, dispatcher, loader, driver, store_manager) because BetterAuth's admin
  plugin writes it. `packages/shared` keeps its own constant arrays and a type test asserts they match.
- Store managers need an outlet, drivers a verified phone, loaders a depot and PIN; a dispatcher's depot is
  optional.
- Users are never deleted, because audit rows point at them. Deactivate keeps the row.
- A role or scope change revokes the user's sessions so new permissions apply at once, and is audited with
  its reason.
- Loader PINs are 4 digits, hashed with the password hasher, unique per depot (checked when set).
  pinHash is never returned (`returned: false`) and never appears in a response DTO.
- Invitation tokens are 32 random bytes, stored only as a sha256 hash, single-use, and last 72 hours.
  Accepting checks that the email or phone matches the invitation.
- Invitation machine: PENDING → ACCEPTED; PENDING → EXPIRED → PENDING on resend; PENDING → REVOKED.
  Moved by the admin and the invitee.
- users has no version column, so user writes take no If-Match.
- compass_readonly cannot read accounts, sessions or verifications, and reads only id, name, role,
  depotId, outletId, defaultVehicleId and createdAt of users.

BetterAuth configuration:

| Setting | Value |
| --- | --- |
| basePath | /api/auth |
| Password | emailAndPassword enabled, minPasswordLength 10, reset through `authMessages.enqueue('password-reset', ...)` |
| Session | expiresIn 7 days, updateAge 1 day, no cookie cache: a cached session outlives its deleted row, and a role or scope change must sign the user out at once (AC-IDN-04) |
| Cookie | HttpOnly, SameSite=Lax, Secure when APP_URL is https (forcing Secure made browsers drop the cookie over plain http: Safari on localhost, any phone on a LAN address), one origin (no CORS, no token in localStorage) |
| trustedOrigins | TRUSTED_ORIGINS plus, outside production, the Vite dev server (http://localhost:5173, http://127.0.0.1:5173), so a fresh checkout signs in without configuration |
| phoneNumber | otpLength 6, expiresIn 300 s, allowedAttempts 5, `authMessages.enqueueOtp` (SMS provider) |
| admin | `admin({ ac, roles, defaultRole: 'store_manager' })` |
| Rate limits | global 100 per 60 s; /sign-in/email 10 per 60 s; /sign-in/pin 5 per 60 s; /sign-in/demo 20 per 60 s; /phone-number/send-otp 3 per 300 s |
| bearer | only when ENABLE_BEARER=true (Flutter, later) |
| Additional user fields | depotId, outletId, defaultVehicleId (input: false), pinHash (input: false, returned: false), locale (default en) |

Settings registered by `SettingsService` (each with a zod schema and a default):

| Setting | Default | Used by | Edited on |
| --- | --- | --- | --- |
| ordering.cutoffMin | 960 (16:00), with per-depot override | Cutoff, M1, M2 | A6, A4 |
| ordering.cutoffReminderMin | 930 (15:30) | Reminder to outlets with no order | A6 |
| planning.reeferCarriesAmbient | false | Engine temperature rule | A6 |
| planning.enforceWindows | true (false for the Task 2B export) | Engine window rules | — |
| planning.freshStartMin | 210 (03:30) | Engine schedule | A6 |
| planning.reloadMinutes | 30 | Gap between a vehicle's two trips | A6 |
| planning.repeatSkipLookbackRuns | 1 | REPEAT_SKIP rule | A6 |
| planning.techValueLimitLkr | 250000 | TECH_VALUE_LIMIT rule | A6 |
| planning.priorityWeights | See Step 5 | Engine priority score | — |
| loading.maxReleaseTempC | 5.0 | Release check for chilled trips | A6 |
| tracking.offlineAlertMinutes | 30 | Vehicle offline alert | A6 |
| tracking.etaSlipNotifyMinutes | 15 | Store ETA notification | A6 |
| tracking.lateRiskThreshold | 0.5 | LATE_RISK alert | A6 |
| store.mustAcknowledgeDeferral | true | M4 | A6 |
| demo.clock | { mode: 'real' } | ClockService | A6, demo mode only |

## Endpoints
BetterAuth routes sit under `/api/auth/*`; every other path below is under `/api/v1`.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | /api/auth/sign-in/email | public | A0; BetterAuth; email or username and password; 7-day sliding session |
| POST | /api/auth/phone-number/send-otp | public | D0a; 6-digit code by SMS |
| POST | /api/auth/phone-number/verify | public | D0b |
| POST | /api/auth/sign-in/pin | public, dock device | L1, L1m; body `{ depotId, pin (4 digits), deviceId }` |
| POST | /api/auth/sign-in/demo | session, demo mode only | The account menu's Switch user: signs the caller in **as** another seeded user, body `{ userId }`. The plugin is registered only when DEMO_MODE=true, so otherwise the route does not exist. Not impersonation: the session becomes that user's own, and BetterAuth's impersonate routes stay disabled |
| POST | /api/auth/sign-out | session | D13, Switch user; D13 waits for an empty outbox |
| GET | / | any | API root with the role's landing links |
| GET, PATCH | /me | any | Profile, role, scope, permission list, locale (D12) |
| GET, POST | /me/devices | any | Register the device: id, platform, app version |
| PUT | /me/devices/{id}/push | any | Save a Web Push subscription |
| GET | /users | user:list | A1: filter by role, depot, outlet, status; search by name; offset pages |
| GET | /users/scope-options | user:list | Depots, outlets and vehicles a user or invitation can be linked to (A1, A2). Reads master data until /depots, /outlets and /vehicles exist |
| GET, PATCH | /users/{id} | user:list, user:set-role | Role and scope changes need a reason and revoke the user's sessions |
| POST | /users/{id}/deactivate, /users/{id}/reactivate | user:ban | Keeps the row; 409 if the driver has trips today, with a link to 20 Reassign |
| PUT | /users/{id}/pin | user:set-password | Loader PIN, unique per depot |
| GET, POST | /invitations | user:create | A1 pending list, A2 create; Idempotency-Key on create |
| GET | /invitations/{id} | user:create | One invitation; the self link and the Location of a create |
| POST | /invitations/{id}/resend, /invitations/{id}/revoke | user:create | New token and expiry on resend |
| GET | /invitations/by-token/{token} | public | Invite landing: name, role, expiry |
| POST | /invitations/{token}/accept | public | Creates the user and signs them in |
| GET | /devices, /devices/{id} | settings:manage | A6 dock tablets card: registered devices; filter by isDockDevice, depotId, platform |
| PUT, DELETE | /devices/{id}/dock | settings:manage | Marks a tablet as a dock device for a depot (body `{ depotId }`), or stops it being one |
| GET, PUT | /settings, /settings/{key} | settings:read, settings:manage | A6; validated by the key's schema. `?depotId=` resolves or sets a depot override (keys with one only) |
| DELETE | /settings/{key}?depotId= | settings:manage | Removes a depot's override |
| GET, POST | /deferral-reasons | deferral:read, settings:manage | A6 reason list. Served by the planning module, which owns the table |
| GET, PATCH | /deferral-reasons/{code} | deferral:read, settings:manage | Engine reasons can be relabelled, never switched off (409) |
| GET, PUT | /clock | any, settings:manage | Demo time travel, only when DEMO_MODE=true |
| POST | /demo/reset | settings:manage | Rebuilds the demo day; demo mode only. 501 until the S1 seed registers a DemoDayBuilder (ROO-22) |
| GET | /demo/inbox | public, demo mode only | The last 50 SMS and emails, so judges can read OTP codes |
| GET | /demo/users | any, demo mode only | Who the account menu may switch to, ordered store manager, dispatcher, loader, driver, admin, each with its scope named. 404 outside demo mode, which is how the web app knows not to offer the switch |

A1 example request: `GET /users?filter[role]=driver&q=aniqa&limit=10`. Tables use offset pages (limit
default 10, max 100) with `meta.page { limit, offset, total }`.

The API root as Tihara (dispatcher, all depots) carries `_links` self, me, today
(`/api/v1/depots/PLG/days/<today>`), tomorrowPlan (`/api/v1/depots/PLG/plans/<tomorrow>`), orders
(templated), alerts, tracking, events (`/api/v1/streams/me`) and docs. A driver's root carries myTrips, a
loader's loadingBoard, and a store manager's myOrders and deliveries instead:

| Role | Links besides self, me, events and docs |
| --- | --- |
| dispatcher | today, tomorrowPlan, orders (templated), alerts, tracking; depot PLG when the dispatcher has none |
| driver | myTrips (`/api/v1/me/trips?date=<today>`) |
| loader | loadingBoard (`/api/v1/depots/<depotId>/loading/runs?date=<today>`) |
| store_manager | myOrders (`/api/v1/orders{?filter,sort,q,limit,offset}`), deliveries (`/api/v1/orders?filter[deliveryDate]=<today>`) |
| admin | users (`/api/v1/users{?filter,q,limit,offset}`), settings (`/api/v1/settings`) |

## Services and helpers
- Request pipeline (Step 2): BetterAuth's global AuthGuard resolves the session from the cookie
  (`@AllowAnonymous()` routes skip it); `ActorGuard` builds the Actor (id, role, depotId, outletId,
  vehicleId, deviceId, name) into CLS and the logger context; `PermissionGuard` checks
  `@RequirePermission('<resource>:<action>')` against the shared matrix and answers 403.
- Policies: the `ScopePolicy` base class and `can(actor, permission)` from `packages/shared`. Out of scope
  is 404; a missing permission is 403.
- Auth: `auth.ts` exports `createAuth(deps)`. `IdentityAuthModule` builds it from Nest's database (the
  API's one pool), config and `AuthMessages`, and exposes it as the `AUTH` token;
  `AuthModule.forRootAsync()` from `@thallesp/nestjs-better-auth` mounts `/api/auth` with its global guard
  turned off, because `CoreModule` runs BetterAuth's `AuthGuard`, `ActorGuard` and `PermissionGuard` as one
  ordered chain. `loader-pin.plugin.ts` adds `/sign-in/pin`: it loads the device, refuses with 403
  `NOT_A_DOCK_DEVICE` unless `isDockDevice` and the depot match, verifies the PIN against each active
  loader of that depot (home depot or `loader_depots`), then creates the session and sets the cookie;
  otherwise 401 `WRONG_PIN` "Wrong PIN". Errors under `/api/auth` are BetterAuth's `{ code, message }`,
  not problem+json.
- Rate limits are BetterAuth's, per client IP (a single `x-forwarded-for` value, which Caddy sets) and
  path, held in memory in each API instance. They are on in every environment, and explicit rules
  replace BetterAuth's built-in `/sign-in*` rule of 3 per 10 s. Several API replicas need Redis storage.
- Sign-up is off (`disableSignUp`): accounts come from invitations and the seed. Admin routes that delete
  or impersonate users are disabled (`disabledPaths`).
- identity: `MeService`; `UsersService` (role and scope changes with session revocation, deactivate, reactivate,
  PIN); `UserQueries`; `InvitationsService` with `newToken()` and `hashToken()`; `DevicesService` (register, dock
  flag, push subscription); `PinService` (set, verify, per-depot uniqueness).
- Invitation flow: A2 posts name, role, scope and email or phone; `POST /invitations` stores the token as a
  sha256 hash with a 72-hour expiry and queues the invite email or SMS. The link opens `/invite/:token`:
  email roles set a password, drivers verify their phone with a code. Accept creates the user through
  `auth.api.createUser` with role and scope, marks the invitation ACCEPTED and signs them in.
- core: `SettingsService` (resolves depot override, then global, then default; audits and broadcasts every
  change); `ClockService` (`now()`, `realNow()`, `businessDate()`, `minutesOfDay()`; modes real, offset,
  frozen, simulated; the mode lives in the demo.clock setting, is honoured only when DEMO_MODE=true and is
  cached for 5 seconds); `DemoService` (reset and inbox).
- Helpers: `maskPhone` (+94 77 ••• 1932), `roleLabel`.
- Sign-ins, sign-outs, failed attempts and role or scope changes are audited through the integration's
  after-hooks. Every PIN sign-in is audited with the device id.
- Web: every envelope carries `meta.serverTime`; `useServerClock()` aligns to it and the header shows a
  badge such as "Demo time Tue 15:55" whenever the clock mode is not real. A6 has a Time travel card: set,
  shift, freeze, back to real.

## Events
Emits (through `OutboxService.add()` in the use case's transaction):

| Event | Consumed by |
| --- | --- |
| identity.user.invited | notifications (invite email, or SMS for drivers: "You're invited to Waypoint Compass.") |
| identity.user.joined | notifications (welcome) |
| identity.user.role_changed | realtime (force the client to refresh /me) |
| identity.user.scope_changed | realtime (force the client to refresh /me); a change of depot, outlet or vehicle with the same role |
| identity.user.deactivated | realtime (force the client to refresh /me) |
| identity.user.reactivated, identity.user.pin_set | none yet (rule 4: every state change emits) |
| identity.invitation.revoked | none yet |
| identity.device.dock_changed | realtime (the depot's dock tablets) |
| deferral_reason.created, deferral_reason.updated (planning) | realtime (refetch the reason list) |
| demo.reset (core) | realtime to every client |
| settings.changed, clock.changed (core) | realtime to every client, on the broadcast channel |

Payloads follow the Step 2 rule: typed, `v: 1`, ids and the few fields consumers need. The doc gives no
field list for these events.

`identity.user.role_changed` and `identity.user.scope_changed` carry `{ v: 1, userId, role, depotId, outletId }`
(`UserAccessChangedEvent` in `events/identity.events.ts`). They route by the aggregate `['user', id]` only:
`outbox_events` has no column for user channels yet, so realtime reads the userId from the payload.

The other payloads (`events/identity.events.ts`): `identity.user.invited` `{ v, invitationId, role, channel, resend }`,
`identity.user.joined` `{ v, userId, invitationId, role }`, `identity.user.deactivated`, `reactivated` and `pin_set`
`{ v, userId }`, `identity.invitation.revoked` `{ v, invitationId }`, `identity.device.dock_changed`
`{ v, deviceId, isDockDevice, depotId }`, `settings.changed` `{ v, key, depotId }`, `clock.changed` `{ v, mode }`,
`demo.reset` `{ v, days }`. None carries a name, email, phone number, PIN or token.

Consumes: none.

## Log events
- `auth.sign_in.succeeded`, `auth.sign_in.failed` (method, role)
- `auth.otp.sent` (masked phone)
- `auth.pin.failed` (device, depot)
- `identity.invitation.created`, `identity.invitation.sent` (channel only), `identity.invitation.resent`,
  `identity.invitation.revoked`, `identity.invitation.accepted`
- `identity.user.role_changed`, `identity.user.scope_changed`, `identity.user.deactivated`, `identity.user.reactivated`,
  `identity.user.pin_set`, `identity.device.dock_changed` (ids and sessionsRevoked only)
- `core.setting.changed` (key, depotId), `core.clock.changed` (mode)
- `demo.reset`

Never logged: cookies, tokens, passwords, PINs, OTP codes, full phone numbers and emails. The pino redact
list covers `req.headers.cookie`, `req.headers.authorization`, `*.password`, `*.pin`, `*.code`, `*.token`,
`*.phoneNumber` and `*.email`.

## Permissions
From `packages/shared/src/auth/permissions.ts`. The `user:*` and `session:*` permissions come from
BetterAuth's `defaultStatements`; only admin holds them, as `adminAc` without `user:delete` and
`user:impersonate`, because users are never deleted and nobody acts as someone else.
`permissions.test.ts` there lists every permission with the roles that hold it.

| Permission | admin | dispatcher | store_manager | loader | driver |
| --- | --- | --- | --- | --- | --- |
| user:list, user:set-role, user:ban, user:set-password, user:create, user:set-email, user:get, user:update | yes | — | — | — | — |
| user:delete, user:impersonate | — | — | — | — | — |
| session:list, session:revoke, session:delete | yes | — | — | — | — |
| settings:read | yes | yes | — | — | — |
| settings:manage | yes | — | — | — | — |
| deferral:read | yes | yes | yes | — | — |

Scopes applied by every ScopePolicy, and the seeded judge accounts:

| Role | Scope | Seeded account |
| --- | --- | --- |
| Admin | Everything | Rusiru Withanage, rusiru.w@waypoint.lk |
| Dispatcher | depotId = actor.depotId, or all depots when none is set; the header's depot switch defaults to Peliyagoda | Tihara Egodage, tihara.e@waypoint.lk, all depots |
| Store manager | outletId = actor.outletId for orders, deferrals, receipts, issues and ETAs | Nimesha Periyapperuma, nimesha.p@waypoint.lk, Fresh Kadawatha |
| Loader | depotId = actor.depotId, trips for today and tomorrow | Harini De Mel, Peliyagoda dock, PIN 2468 |
| Driver | Trips where driverId = actor.id in the last 7 days (D10) | Aniqa Razick, +94 77 604 1932, REF-07 |
| Driver, second story | Same rule | Dinushi Rathnayake, +94 77 555 0107, DRY-31 |

Passwords come from SEED_PASSWORD (10+ characters; unset skips the accounts). The seed creates users through
BetterAuth's server API, so hashes match real sign-ups, and hashes PINs with the same password hasher.
Usernames are the email's local part (rusiru.w, tihara.e, nimesha.p, harini.d) and aniqa.r and dinushi.r for
the drivers. Harini's email is harini.d@waypoint.lk. A driver's depot is her vehicle's depot. The seed also
registers the dock tablets dock-plg-01 (PLG) and dock-kdy-01 (KDY), so a loader can sign in before A6 exists.
Re-running the seed keeps each id and resets role, scope, PIN and password.

| Role | Screens | Sign-in method |
| --- | --- | --- |
| Admin, dispatcher, store manager | A0 | Email or username and password at /api/auth/sign-in/email; 7-day sliding session |
| Driver | D0a, D0b | Phone and 6-digit SMS code through the phoneNumber plugin; the phone stays signed in so trips work offline; in demo mode the code appears in /demo/inbox |
| Loader | L1, L1m | Depot plus 4-digit PIN at /api/auth/sign-in/pin, only on a registered dock device; Switch user signs out and in; 20 idle minutes signs out |

## Acceptance criteria
Times are Asia/Colombo. "Real time" means `ClockService.realNow()` (token and session expiry); "the demo
clock" means `ClockService.now()`. AC-IDN-01 to 04 carry the IDs the Build Spec gave them.

- [x] AC-IDN-01 Another outlet's order is not found
- [x] AC-IDN-02 PIN needs this depot's dock device
- [x] AC-IDN-03 Late invitation acceptance gets 409
- [x] AC-IDN-04 Role change revokes sessions
- [x] AC-IDN-05 Sixth PIN attempt gets 429
- [ ] AC-IDN-06 Row-level security backs up scope
- [ ] AC-IDN-07 PIN signs a loader in
- [ ] AC-IDN-08 A wrong PIN is refused
- [ ] AC-IDN-09 Email sign-in opens a session
- [ ] AC-IDN-10 A wrong password is refused
- [ ] AC-IDN-11 Eleventh email sign-in gets 429
- [x] AC-IDN-12 Dispatcher root lists landing links
- [x] AC-IDN-13 Field roles get their landing links
- [ ] AC-IDN-14 Sign-in code reaches the demo inbox
- [ ] AC-IDN-15 Driver signs in with the code
- [ ] AC-IDN-16 Fourth code request gets 429
- [ ] AC-IDN-17 A stale or over-tried code fails
- [ ] AC-IDN-18 Sign-out ends the session
- [ ] AC-IDN-19 D13 waits for an empty outbox
- [ ] AC-IDN-20 Dock signs out after 20 idle minutes
- [ ] AC-IDN-21 Switch user returns to L1
- [x] AC-IDN-22 /me shows role, scope and permissions
- [x] AC-IDN-23 A user changes their own locale
- [x] AC-IDN-24 /me refuses role and scope edits
- [x] AC-IDN-25 A device registers itself
- [ ] AC-IDN-26 A device saves its push subscription
- [x] AC-IDN-27 Admin marks a dock device
- [x] AC-IDN-28 Admin lists and searches users
- [x] AC-IDN-29 Non-admins are refused admin routes
- [x] AC-IDN-30 No session gets 401
- [x] AC-IDN-31 Role change needs a reason
- [x] AC-IDN-32 Scope change revokes sessions
- [x] AC-IDN-33 Driver with trips today stays active
- [x] AC-IDN-34 Deactivation keeps the user row
- [x] AC-IDN-35 Reactivation restores the user
- [x] AC-IDN-36 PIN is unique per depot
- [x] AC-IDN-37 PIN must be four digits
- [x] AC-IDN-38 Admin sets a loader PIN
- [x] AC-IDN-39 Admin invites a driver
- [x] AC-IDN-40 Invitation create is idempotent
- [x] AC-IDN-41 Invitation scope follows the role
- [x] AC-IDN-42 Invite landing shows name and expiry
- [x] AC-IDN-43 Accepting creates the user
- [x] AC-IDN-44 Accept refuses a mismatched email
- [x] AC-IDN-45 A used invitation can't be reused
- [x] AC-IDN-46 Driver accepts with an SMS code
- [x] AC-IDN-47 Resend issues a new token
- [x] AC-IDN-48 Revoked invitation can't be accepted
- [x] AC-IDN-49 Dispatchers read settings
- [x] AC-IDN-50 A setting must match its schema
- [x] AC-IDN-51 A setting change is audited and broadcast
- [x] AC-IDN-52 Settings resolve override, global, then default
- [x] AC-IDN-53 Admin freezes the demo clock
- [x] AC-IDN-54 Admin shifts the demo clock
- [x] AC-IDN-55 Admin returns the clock to real
- [x] AC-IDN-56 Demo mode off disables time travel
- [x] AC-IDN-57 Engine deferral reasons stay active
- [x] AC-IDN-58 Admin adds a deferral reason
- [x] AC-IDN-59 Demo reset rebuilds the demo day
- [x] AC-IDN-60 Routes match the permission matrix

```gherkin
AC-IDN-01  Another outlet's order is not found
  Given Nimesha Periyapperuma, store manager for Fresh Kadawatha (OUT014), is signed in
    And a SUBMITTED order for 2026-10-02 belongs to another Peliyagoda outlet
  When she requests GET /orders/{id} for that order
  Then the response is 404 NOT_FOUND as application/problem+json
    And the body is the same as for an order id that does not exist

AC-IDN-02  PIN needs this depot's dock device
  Given Harini De Mel is a loader at Peliyagoda (PLG) with PIN 2468
    And tablet T2 is a dock device for Kandy (isDockDevice true, depotId KDY)
    And phone P1 is registered with isDockDevice false
  When POST /api/auth/sign-in/pin receives { depotId: "PLG", pin: "2468" } with deviceId T2, or with deviceId P1
  Then each answers 403 FORBIDDEN, which L1 shows as "not a dock device"
    And no sessions row is created for her

AC-IDN-03  Late invitation acceptance gets 409
  Given admin Rusiru Withanage created a driver invitation at real time 2026-09-30T09:00:00+05:30
    And its expiresAt is 2026-10-03T09:00:00+05:30
  When the invitee posts /invitations/{token}/accept at real time 2026-10-03T09:00:01+05:30
  Then the response is 409 CONFLICT_STATE and no users row is created
    And the invitation is not ACCEPTED
    And GET /invitations lists it with status EXPIRED and a resend link, which A1 shows as expired with Resend

AC-IDN-04  Role change revokes sessions
  Given a loader at Peliyagoda (depotId PLG) with two active sessions
    And admin Rusiru Withanage is signed in
  When he sends PATCH /users/{id} with role dispatcher and a reasonCode
  Then the response is 200 with role dispatcher and depotId PLG
    And both of the user's sessions rows are deleted, so either old cookie now gets 401 UNAUTHENTICATED
    And exactly one audit row identity.user.role_changed exists with the reasonCode and the role before and after
    And exactly one outbox event identity.user.role_changed exists, so realtime tells the user's client to refresh /me

AC-IDN-05  Sixth PIN attempt gets 429
  Given tablet T1 is a dock device for Peliyagoda (isDockDevice true, depotId PLG)
    And five PIN sign-ins from T1 with a PIN no Peliyagoda loader holds arrived in the last 40 seconds
  When a sixth PIN sign-in arrives within 60 seconds of the first
  Then the response is 429 and no session is created

AC-IDN-06  Row-level security backs up scope
  Given a test module with OrderScope removed from the order queries
    And Nimesha Periyapperuma, store manager for Fresh Kadawatha, is signed in
  When she requests GET /orders
  Then every order returned belongs to Fresh Kadawatha, because the orders policy re-checks outletId

AC-IDN-07  PIN signs a loader in
  Given Harini De Mel is a loader at Peliyagoda with PIN 2468
    And tablet T1 is a dock device for Peliyagoda
  When POST /api/auth/sign-in/pin receives { depotId: "PLG", pin: "2468", deviceId: "T1" }
  Then the response is 200 with { user: { id, name: "Harini De Mel" } } and sets a session cookie
    And one audit row records the PIN sign-in with deviceId T1
    And the log has auth.sign_in.succeeded with method and role loader, and no PIN value

AC-IDN-08  A wrong PIN is refused
  Given tablet T1 is a dock device for Peliyagoda
  When POST /api/auth/sign-in/pin receives depotId PLG, deviceId T1 and a PIN no Peliyagoda loader holds
  Then the response is 401 with the message "Wrong PIN", which L1 shows as the wrong-PIN state
    And no session is created
    And the log has one auth.pin.failed line with the device and depot and no PIN
    And the failed attempt is audited with deviceId T1

AC-IDN-09  Email sign-in opens a session
  Given Tihara Egodage, dispatcher, whose password comes from SEED_PASSWORD
  When she posts her email and password to /api/auth/sign-in/email
  Then the response is 200 and sets an HttpOnly, Secure, SameSite=Lax session cookie
    And her sessions row expires 7 days after the real time of sign-in
    And one audit row records the sign-in
    And the log has auth.sign_in.succeeded with method and role dispatcher, and no email

AC-IDN-10  A wrong password is refused
  Given Tihara Egodage's account
  When she posts her email with a wrong password to /api/auth/sign-in/email
  Then the response is 401, which A0 shows as the wrong-password state
    And no session is created
    And the log has auth.sign_in.failed with method and role, and no password or email
    And the failed attempt is audited

AC-IDN-11  Eleventh email sign-in gets 429
  Given ten requests to /api/auth/sign-in/email from one client arrived in the last 50 seconds
  When an eleventh arrives within 60 seconds of the first
  Then the response is 429, which A0 shows as the rate-limited state
    And no session is created

AC-IDN-12  Dispatcher root lists landing links
  Given Tihara Egodage, dispatcher with no depotId (all depots), is signed in
    And the demo clock is frozen at 2026-10-01T15:12:00+05:30
  When she requests GET /
  Then data.actor is { name: "Tihara Egodage", role: "dispatcher", depotId: null }
    And data._links holds self, me, today (/api/v1/depots/PLG/days/2026-10-01), tomorrowPlan
        (/api/v1/depots/PLG/plans/2026-10-02), orders (templated), alerts, tracking, events (/api/v1/streams/me) and docs
    And meta.serverTime is 2026-10-01T15:12:00+05:30

AC-IDN-13  Field roles get their landing links
  Given Aniqa Razick (driver), Harini De Mel (loader) and Nimesha Periyapperuma (store manager) are signed in
  When each requests GET /
  Then Aniqa's _links include myTrips, Harini's include loadingBoard, and Nimesha's include myOrders and deliveries
    And none of the three includes today, tomorrowPlan or tracking

AC-IDN-14  Sign-in code reaches the demo inbox
  Given DEMO_MODE=true and SMS_PROVIDER=demo-inbox
    And Aniqa Razick is a driver with verified phone +94 77 604 1932
  When D0a posts her number to /api/auth/phone-number/send-otp
  Then a worker job sends a 6-digit code, and GET /demo/inbox lists it under her number
    And the log has auth.otp.sent with the phone masked as +94 77 ••• 1932 and no code

AC-IDN-15  Driver signs in with the code
  Given a code was sent to Aniqa Razick's number 200 seconds ago
  When D0b posts her number and that code to /api/auth/phone-number/verify
  Then a session cookie is set
    And GET / as Aniqa returns her myTrips link

AC-IDN-16  Fourth code request gets 429
  Given three send-otp requests for Aniqa Razick's number arrived in the last 240 seconds
  When a fourth arrives within 300 seconds of the first
  Then the response is 429 and no fourth code reaches the demo inbox

AC-IDN-17  A stale or over-tried code fails
  Given a code sent to Aniqa Razick's number
    And either 301 seconds have passed since it was sent, or five wrong codes have been posted against it
  When D0b posts that code to /api/auth/phone-number/verify
  Then the code is refused and no session is created

AC-IDN-18  Sign-out ends the session
  Given Tihara Egodage is signed in
  When she posts /api/auth/sign-out
  Then her sessions row is deleted
    And the next API request with the old cookie answers 401 UNAUTHENTICATED
    And the sign-out is audited

AC-IDN-19  D13 waits for an empty outbox
  Given Aniqa Razick is signed in on her phone with 3 records in the offline outbox
  When she confirms D13 Sign out
  Then the app does not call /api/auth/sign-out until the outbox is empty
    And the dialog offers no option to discard the records

AC-IDN-20  Dock signs out after 20 idle minutes
  Given Harini De Mel is signed in on the Peliyagoda dock tablet on L2
  When 20 minutes pass with no input
  Then the app signs her out through /api/auth/sign-out and shows L1

AC-IDN-21  Switch user returns to L1
  Given Harini De Mel is signed in on the Peliyagoda dock tablet
  When she taps Switch user
  Then the app signs her out through /api/auth/sign-out and shows L1 for the next loader's PIN

AC-IDN-22  /me shows role, scope and permissions
  Given Nimesha Periyapperuma, store manager for Fresh Kadawatha, is signed in
  When she requests GET /me
  Then data holds her name, role store_manager, outletId OUT014, locale en and the store_manager permission list
    And the list includes order:submit and not plan:publish
    And data has no pinHash

AC-IDN-23  A user changes their own locale
  Given Aniqa Razick is signed in on D12
  When she sends PATCH /me with { locale: "si" }
  Then the response is 200 with locale si

AC-IDN-24  /me refuses role and scope edits
  Given Nimesha Periyapperuma, store manager for Fresh Kadawatha, is signed in
  When she sends PATCH /me with { role: "admin" }, or with { outletId: "<another outlet>" }
  Then each answers 400 VALIDATION_FAILED naming the field
    And her role and outletId are unchanged

AC-IDN-25  A device registers itself
  Given Aniqa Razick is signed in on a phone whose device id is P2
  When the app posts /me/devices with { id: "P2", platform: "PWA", appVersion }
  Then GET /me/devices lists P2 with platform PWA, that appVersion and isDockDevice false

AC-IDN-26  A device saves its push subscription
  Given device P2 is registered to Aniqa Razick
  When the app sends PUT /me/devices/P2/push with a Web Push subscription
  Then the devices row for P2 holds pushEndpoint, pushP256dh and pushAuth

AC-IDN-27  Admin marks a dock device
  Given tablet T3 was registered through POST /me/devices and has isDockDevice false
    And admin Rusiru Withanage is signed in
  When he sends PUT /devices/T3/dock with depotId PLG
  Then T3 has isDockDevice true and depotId PLG
    And Harini De Mel's PIN sign-in for depot PLG from T3 now succeeds

AC-IDN-28  Admin lists and searches users
  Given admin Rusiru Withanage is signed in
  When he requests GET /users?filter[role]=driver&q=aniqa&limit=10
  Then the response is 200 with Aniqa Razick in data and meta.page { limit: 10, offset: 0, total }
    And no item in data has pinHash

AC-IDN-29  Non-admins are refused admin routes
  Given the seeded dispatcher, store manager, loader and driver accounts
  When each calls GET /users, PATCH /users/{id}, POST /users/{id}/deactivate, PUT /users/{id}/pin, POST /invitations,
       PUT /devices/{id}/dock, PUT /settings/{key}, PUT /clock and POST /demo/reset
  Then every call answers 403 FORBIDDEN as application/problem+json
    And nothing is written: no row changes, no audit row and no outbox event
    And GET /settings answers 403 for the store manager, loader and driver, and 200 for the dispatcher

AC-IDN-30  No session gets 401
  Given a request with no session cookie
  When it calls GET /users or GET /me
  Then the response is 401 UNAUTHENTICATED as application/problem+json

AC-IDN-31  Role change needs a reason
  Given admin Rusiru Withanage and a loader at Peliyagoda with an active session
  When he sends PATCH /users/{id} with role dispatcher and no reasonCode
  Then the response is 400 VALIDATION_FAILED with errors [{ field: "reasonCode", code: "required", message: "A reason is required" }]
    And the user's role, scope and sessions are unchanged
    And no audit row or outbox event is written

AC-IDN-32  Scope change revokes sessions
  Given admin Rusiru Withanage and a loader at Peliyagoda with an active session
  When he sends PATCH /users/{id} with depotId KDY and a reasonCode
  Then the response is 200 with depotId KDY
    And the loader's sessions rows are deleted
    And exactly one audit row identity.user.scope_changed carries the reasonCode and the depotId before and after

AC-IDN-33  Driver with trips today stays active
  Given the demo clock reads 2026-10-02T05:00:00+05:30
    And Dinushi Rathnayake, driver on DRY-31, has a trip dated 2026-10-02
  When admin Rusiru Withanage posts /users/{id}/deactivate for her
  Then the response is 409 CONFLICT_STATE with a link to reassign that trip (screen 20)
    And banned stays false
    And no audit row or outbox event is written

AC-IDN-34  Deactivation keeps the user row
  Given the demo clock reads 2026-10-02T05:00:00+05:30
    And a background driver has no trip dated 2026-10-02
  When admin Rusiru Withanage posts /users/{id}/deactivate for that driver
  Then the response is 200 and the users row still exists with banned true
    And exactly one outbox event identity.user.deactivated exists
    And openapi.json has no route that deletes a user

AC-IDN-35  Reactivation restores the user
  Given the driver deactivated in AC-IDN-34
  When admin Rusiru Withanage posts /users/{id}/reactivate
  Then the response is 200 with banned false

AC-IDN-36  PIN is unique per depot
  Given Harini De Mel holds PIN 2468 at Peliyagoda
    And a second Peliyagoda loader exists
  When admin Rusiru Withanage sends PUT /users/{second loader}/pin with pin "2468"
  Then the response is 409 CONFLICT_STATE
    And the second loader's pinHash is unchanged

AC-IDN-37  PIN must be four digits
  Given a Peliyagoda loader and admin Rusiru Withanage
  When he sends PUT /users/{id}/pin with pin "24a8"
  Then the response is 400 VALIDATION_FAILED with an error on pin
    And the loader's pinHash is unchanged

AC-IDN-38  Admin sets a loader PIN
  Given Harini De Mel holds PIN 2468 at Peliyagoda
    And a Kandy loader has no PIN
  When admin Rusiru Withanage sends PUT /users/{Kandy loader}/pin with pin "2468"
  Then the response is 200, because PINs are unique only within a depot
    And the Kandy loader's pinHash holds a hash from the password hasher, not the digits
    And the Kandy loader can sign in with 2468 on a Kandy dock device
    And the response has no pinHash or PIN

AC-IDN-39  Admin invites a driver
  Given admin Rusiru Withanage is on A2 at real time 2026-09-30T10:00:00+05:30
    And DEMO_MODE=true with SMS_PROVIDER=demo-inbox
  When he posts /invitations with name, role driver, depotId PLG, a phoneNumber in +94 format, a Peliyagoda vehicleId and an Idempotency-Key
  Then the response is 201 with a Location header, status PENDING and expiresAt 2026-10-03T10:00:00+05:30
    And the invitations row holds tokenHash, the sha256 of a random 32-byte token, and not the token itself
    And exactly one audit row identity.invitation.created and one outbox event identity.user.invited exist
    And the log has identity.invitation.created with no phone number or token
    And the invite SMS reaches the demo inbox, because drivers are invited by SMS

AC-IDN-40  Invitation create is idempotent
  Given the invitation from AC-IDN-39 was created with Idempotency-Key K1
  When the same request is sent again with K1 and the same body
  Then the stored 201 response comes back with Idempotent-Replayed: true
    And exactly one invitation, one audit row and one outbox event exist for it

AC-IDN-41  Invitation scope follows the role
  Given admin Rusiru Withanage on A2
  When he posts /invitations for each of these:
       a store_manager with an email and no outletId
       a loader with no depotId
       a driver with no phoneNumber
       a dispatcher with an email and no depotId
  Then the first three answer 400 VALIDATION_FAILED with an error on outletId, depotId and phoneNumber respectively
    And no invitation row exists for those three
    And the dispatcher invitation answers 201, because a dispatcher's depot is optional

AC-IDN-42  Invite landing shows name and expiry
  Given a PENDING email invitation for a store manager at Fresh Kadawatha, created at real time 2026-09-30T10:00:00+05:30
  When the invitee opens /invite/:token and the page calls GET /invitations/by-token/{token}
  Then the response holds the name, role store_manager and expiresAt 2026-10-03T10:00:00+05:30
    And no session is created

AC-IDN-43  Accepting creates the user
  Given the PENDING store manager invitation from AC-IDN-42
  When the invitee posts /invitations/{token}/accept with the invited email and a 12-character password at real time 2026-10-01T09:00:00+05:30
  Then a users row exists with role store_manager and outletId OUT014, created through auth.api.createUser
    And the invitation is ACCEPTED with acceptedAt and userId set
    And the response sets a session cookie
    And exactly one outbox event identity.user.joined exists and the log has identity.invitation.accepted

AC-IDN-44  Accept refuses a mismatched email
  Given the PENDING store manager invitation from AC-IDN-42
  When the invitee posts /invitations/{token}/accept with a different email
  Then the request is refused and no users row is created
    And the invitation stays PENDING

AC-IDN-45  A used invitation can't be reused
  Given the invitation accepted in AC-IDN-43
  When anyone posts /invitations/{token}/accept with the same token
  Then the response is 409 CONFLICT_STATE
    And exactly one users row exists for the invitation

AC-IDN-46  Driver accepts with an SMS code
  Given a PENDING driver invitation for depot PLG with a phone number
  When the invitee opens /invite/:token, verifies the invited phone with the SMS code and accepts
  Then a users row exists with role driver, depotId PLG, that phoneNumber and phoneNumberVerified true
    And its email is <id>@drivers.waypoint.local
    And the invitation is ACCEPTED and the response sets a session cookie

AC-IDN-47  Resend issues a new token
  Given the EXPIRED invitation from AC-IDN-03
  When admin Rusiru Withanage posts /invitations/{id}/resend at real time 2026-10-03T10:00:00+05:30
  Then the invitation is PENDING with a new tokenHash and expiresAt 2026-10-06T10:00:00+05:30
    And a new invite SMS reaches the demo inbox
    And GET /invitations/by-token/{old token} answers 404 NOT_FOUND
    And one audit row records the resend

AC-IDN-48  Revoked invitation can't be accepted
  Given a PENDING invitation
    And admin Rusiru Withanage has posted /invitations/{id}/revoke, so it is REVOKED
  When the invitee posts /invitations/{token}/accept
  Then the response is 409 CONFLICT_STATE and no users row is created

AC-IDN-49  Dispatchers read settings
  Given Tihara Egodage, dispatcher, and no settings rows beyond the defaults
  When she requests GET /settings
  Then the response is 200 and lists every registered key with its value
    And ordering.cutoffMin is 960, ordering.cutoffReminderMin 930 and loading.maxReleaseTempC 5.0

AC-IDN-50  A setting must match its schema
  Given admin Rusiru Withanage
  When he sends PUT /settings/ordering.cutoffReminderMin with the value "15:30"
  Then the response is 400 VALIDATION_FAILED, because the value fails the key's zod schema
    And the stored value is unchanged and no settings.changed event exists

AC-IDN-51  A setting change is audited and broadcast
  Given admin Rusiru Withanage
  When he sends PUT /settings/ordering.cutoffReminderMin with the value 945
  Then the response is 200 and the settings row holds 945 with updatedById set to his id
    And exactly one audit row records the change
    And exactly one outbox event settings.changed goes to every client on the broadcast channel

AC-IDN-52  Settings resolve override, global, then default
  Given no settings row exists for tracking.offlineAlertMinutes
    And a settings row for ordering.cutoffMin has scope PLG and value 930, and none has scope KDY or global
  When SettingsService resolves both keys for depots PLG and KDY
  Then tracking.offlineAlertMinutes is 30 for both depots
    And ordering.cutoffMin is 930 for PLG and 960 for KDY

AC-IDN-53  Admin freezes the demo clock
  Given DEMO_MODE=true and admin Rusiru Withanage on A6
  When he sends PUT /clock with { mode: "frozen", at: "2026-10-01T15:55:00+05:30" }
  Then the response is 200 and the demo.clock setting holds that mode
    And exactly one outbox event clock.changed goes to every client
    And within 5 seconds every response's meta.serverTime is 2026-10-01T15:55:00+05:30
    And GET /clock shows mode frozen to any signed-in role
    And the header badge reads "Demo time Thu 15:55"

AC-IDN-54  Admin shifts the demo clock
  Given DEMO_MODE=true and admin Rusiru Withanage on A6
  When he sends PUT /clock with { mode: "offset", offsetMs: 3600000 }
  Then within 5 seconds meta.serverTime is one hour after the wall clock
    And exactly one outbox event clock.changed exists for the change

AC-IDN-55  Admin returns the clock to real
  Given DEMO_MODE=true and the clock frozen at 2026-10-01T15:55:00+05:30
  When admin Rusiru Withanage sends PUT /clock with { mode: "real" }
  Then within 5 seconds meta.serverTime follows the wall clock
    And the header shows no demo-time badge

AC-IDN-56  Demo mode off disables time travel
  Given DEMO_MODE=false
    And the demo.clock setting holds { mode: "frozen", at: "2026-10-01T15:55:00+05:30" }
  When admin Rusiru Withanage sends PUT /clock, POST /demo/reset and GET /demo/inbox
  Then each is refused and changes nothing
    And ClockService.now() returns the wall-clock time, so meta.serverTime follows it

AC-IDN-57  Engine deferral reasons stay active
  Given the deferral reason NO_REEFER_CAPACITY with fromEngine true
  When admin Rusiru Withanage sends a PATCH that sets active false on NO_REEFER_CAPACITY
  Then the request is refused
    And NO_REEFER_CAPACITY stays active and still appears in GET /deferral-reasons

AC-IDN-58  Admin adds a deferral reason
  Given admin Rusiru Withanage on A6
  When he posts /deferral-reasons with a new code and label
  Then the response is 201
    And GET /deferral-reasons as Tihara Egodage (dispatcher) lists it with fromEngine false and active true

AC-IDN-59  Demo reset rebuilds the demo day
  Given DEMO_MODE=true and the demo clock's business date is 2026-10-01, so demo day D is 2026-10-02
    And the walkthrough has changed orders and trips on D
  When admin Rusiru Withanage posts /demo/reset
  Then one transaction deletes and rebuilds only seed-sourced rows for D−1 to D+1, and rows outside those days are untouched
    And exactly one audit row records the reset and the log has demo.reset
    And no audit_events row is deleted
    And GET /demo/inbox returns no messages

AC-IDN-60  Routes match the permission matrix
  Given the route list generated from the @RequirePermission metadata
    And the roles object in packages/shared/src/auth/permissions.ts
  When the test calls every route as admin, dispatcher, store_manager, loader and driver
  Then each role gets a 2xx exactly where roles[role].authorize({ <resource>: [<action>] }) succeeds, and 403 FORBIDDEN everywhere else
    And routes marked public or any never answer 403 to a signed-in role
```

## Non-functional
- Every request runs in one transaction stamped with the actor (`app.role`, `app.user_id`,
  `app.depot_id`, `app.outlet_id`); an unstamped request sees no rows on the row-level-security tables.
- Rate limits as configured: 100 requests per 60 s globally; 10 per 60 s on email sign-in; 5 per 60 s on
  PIN sign-in; 3 codes per 300 s per number.
- A 7-day sliding session means a driver who opens the app daily is never signed out mid-route.
- Response DTOs never carry pinHash or scope columns a client could set; outletId, depotId and
  defaultVehicleId are not client input.
- Screens: A0–A6 at 1440 × 960; D0a, D0b, D12, D13 at 390 × 844; L1 at 1194 × 834 landscape and L1m at
  390 × 844. Dock and driver shells use touch density (44-pixel targets).
- Driver and dock sign-in request `navigator.storage.persist()` so the browser doesn't evict the outbox.
- Demo features (clock, reset, inbox) work only when DEMO_MODE=true.

## Open questions
- AC-IDN-03, 45, 48: decided (Nimesha, 1 Oct). A refused accept is 409 CONFLICT_STATE, with a detail per status.
- AC-IDN-04, 32: decided (Nimesha, 1 Oct). The audit actions are identity.user.role_changed and
  identity.user.scope_changed; a change of role and scope together is one role_changed row. AuditService matches
  REASON_REQUIRED on the action without its module (user.role_changed).
- AC-IDN-39: identity.invitation.created is assumed. Action names for sign-in, failed sign-in, sign-out, resend and
  revoke are not given (AC-IDN-07 to 10, 18, 47). Decides: Nimesha.
- Identity imports audit: decided (Nimesha, 1 Oct). depends-on is [core, audit], like every other module that audits.
- AC-IDN-44: decided (Nimesha, 1 Oct). Accept with another email or phone is 400 VALIDATION_FAILED on that field (code
  `mismatch`); a password under 10 characters is 400 on password; a wrong, expired or over-tried code on accept is 400
  on code. AC-IDN-17 (sign-in codes) stays BetterAuth's own answer.
- AC-IDN-01: decided (Nimesha, 30 Sep). GET /orders/{id} is ordering's and does not exist yet, so the test
  mounts a stand-in route with the order scope rule over the real orders table. When ordering ships its
  route and OrderScope, the test moves to that route.
- AC-IDN-02, 07, 08: decided. The refusal codes are `NOT_A_DOCK_DEVICE` (403) and `WRONG_PIN` (401).
- AC-IDN-60: decided. The test stops each request after the guards, so allowed roles get 2xx without any
  handler running, and the criterion keeps its wording. A route that declares none, or more than one, of
  `@RequirePermission`, `@AnyRole` and `@AllowAnonymous` also fails it; `PermissionGuard` refuses such a
  route with 403.
- AC-IDN-13: decided. The hrefs of the field roles' links and admin's links are in the table under Endpoints;
  owners of those screens can change them.
- AC-IDN-56 (inbox part): decided. With DEMO_MODE=false, GET /demo/inbox answers 404, as if it did not exist.
  PUT /clock and POST /demo/reset answer 404 the same way (decided, 1 Oct).
- Driver sign-in codes: the API queues an `auth.otp` job on the notifications queue and the worker writes it
  to the demo inbox (Redis, last 50) when DEMO_MODE=true. Without demo mode the job fails until notifications
  adds an SMS provider (Step 7).
- AC-IDN-36: decided. A PIN another loader of one of the depots already holds is 409 CONFLICT_STATE; uniqueness covers
  every depot the loader works at (home and loader_depots), under a per-depot advisory lock.
- AC-IDN-56: decided. With DEMO_MODE=false all three answer 404, and ClockSync ignores the demo.clock setting.
- AC-IDN-57: decided (Nimesha, 1 Oct; tell Tihara). PATCH /deferral-reasons/{code}; switching off an engine reason is
  409 CONFLICT_STATE; the planning module serves the endpoints because it owns the table.
- GET /deferral-reasons: decided. Admin holds deferral:read.
- AC-IDN-03: decided (Nimesha, 1 Oct). A check on read: a PENDING invitation whose expiresAt has passed in real time
  reads as EXPIRED (`effectiveStatus`), and accept refuses it. No job and no write; the stored status stays PENDING
  until resend or revoke, so a status filter on GET /invitations must use the same rule.
- AC-IDN-39: decided (Nimesha, 1 Oct). The raw link goes only into an `auth.invite` job on the notifications queue
  (Redis, removed when sent); the worker sends it (demo inbox in demo mode). The outbox event carries no token.
- AC-IDN-46: decided. The landing calls /api/auth/phone-number/send-otp for the invited phone, then accept takes
  `{ phoneNumber, code }`; the API checks the code with BetterAuth's server-only consumePhoneNumberOTP before
  createUser, then signs the driver in through the server-only invitation-session plugin.
- Loader invitations: decided (Nimesha, 1 Oct; tell Harini). A loader is invited by email or phone and accepts with
  that email or phone and the 4-digit PIN they will use (unique per depot). No session: they sign in at the dock.
  Without an email their account gets `<id>@loaders.waypoint.local`.
- An EXPIRED invitation can be revoked: decided; the shared invitation machine already allows it.
- AC-IDN-32: a scope-only change emits identity.user.scope_changed (added to Events), mirroring the audit action.
  Chosen while building ROO-27; confirm or change. Decides: Nimesha.
- AC-IDN-34: decided. Deactivate deletes the user's sessions too. A driver's trips today are trips on a plan dated
  today's business date (demo clock) that are not COMPLETED or CANCELLED.
- Reason codes for user.role_changed and user.scope_changed: decided (Nimesha, 1 Oct). `USER_CHANGE_REASONS` in
  packages/shared: TRANSFER, PROMOTION, CORRECTION, OFFBOARDING, OTHER, plus an optional reasonNote.
- Session cookie cache: off (AC-IDN-04), because BetterAuth answers from a cached session cookie for up to its maxAge
  without reading the sessions row. Every request reads the session instead. Turn it back on only with a revocation
  check (for example cookieCache.version). Decides: Nimesha.
- May an admin change their own role or scope, or deactivate themselves? It signs them out and could leave no admin. Decides: Nimesha.
- AC-IDN-59: POST /demo/reset runs every registered DemoDayBuilder (core/demo/demo-day.ts) in one transaction, clears
  the demo inbox and audits. ROO-22 registers SeedDemoDayBuilder, which runs the seed's own rebuild
  (src/db/seed/rebuild.ts) from each depot's snapshot in settings (S1 at Peliyagoda, an ordinary day at Kandy), so
  the API never reads the dataset files.
- Accept creates the account through BetterAuth on its own connection, before the accept transaction commits. If a
  later write fails, the account exists and the invitation stays PENDING, and a retry gets 409 (account exists).
  Rare; a fix needs BetterAuth to share the transaction. Decides: Nimesha.
- planning.priorityWeights uses the keys deferredOnLastRun, consecutiveDeferrals, daysSinceLastServed, fresh, chilled,
  urgent and tightWindow from the engine formula; the allocator (ROO-28) should read them. Decides: Tihara.
- Settings that A6 doesn't edit refuse PUT /settings with 409: demo.clock (PUT /clock), planning.enforceWindows and
  planning.priorityWeights (set in code).
- Event routing to user channels: realtime routes by userIds, which outbox_events cannot store yet. OutboxService
  refuses routing.userIds until ROO-24 adds a column or another rule. Decides: Nimesha.
- AC-IDN-52: decided (Nimesha, 1 Oct). `?depotId=` on GET, PUT and DELETE /settings/{key}; only ordering.cutoffMin takes
  an override. depots.cutoffMin (A4) now duplicates it: Harini to drop it or keep it in sync. Decides: Harini.
- A3 flags outlets with no manager, which needs users data, but master-data may import only core and audit. Which module supplies the flag? Decides: Harini with Nimesha.
- A0 has "forgot password", but no password-reset route is in the endpoints table. Decides: Nimesha.
- Step 3 and Step 4 examples label 2026-10-01 "Wed" and 2026-10-02 "Thu"; the calendar and the Overview make them Thu and Fri. This spec uses ISO dates and the calendar's weekdays. Decides: Nimesha.

## Changelog
- 2026-10-04 Sign-in works for every role from a real browser (ROO-68 bug bash): the cookie's Secure flag
  follows APP_URL instead of being forced; the dev server is a trusted origin by default; every signed-in
  browser registers itself through POST /me/devices so A6 can mark it as a dock tablet (the PIN route had
  nothing to accept before); a 401 under /dock or /driver returns to L1 or D0a, not A0; A0 reads "Email or
  username", maps 403 and links to the other sign-ins; the start page offers the three ways in and sends a
  signed-in person to their role's home; D0a and D0b are built (`driver-sign-in-page.tsx`); `/demo/inbox` is a
  page; D12 is a first account screen with D13's rule (sign-out waits for an empty outbox); the offline
  outbox uses the same device id the API client sends. AC-IDN-15 and 17 have screen tests against a mocked
  auth client; the e2e criteria for sign-in stay open
- 2026-10-03 AC-IDN-59 passes: the S1 demo day registers its builder (ROO-22)
- 2026-09-30 created from the Build Spec
- 2026-09-30 Model: `loader_depots` for loaders who work at more than one depot (merged from the Supabase draft)
- 2026-09-30 AC-IDN-01, 02, 05, 60 implemented (ROO-8): BetterAuth with the username, admin, phoneNumber,
  loaderPin and optional bearer plugins; `ActorGuard`, `PermissionGuard`, `ScopePolicy`; admin without
  user:delete and user:impersonate; auth built through Nest DI instead of at import time
- 2026-09-30 AC-IDN-12, 13, 22 to 25 implemented (ROO-8): GET /, GET and PATCH /me, GET and POST /me/devices,
  GET /demo/inbox, the persona seed and the dock tablets
- 2026-10-01 AC-IDN-03, 04 implemented (ROO-27, on the ROO-7 kernel): PATCH and GET /users/{id} (role and scope
  changes with a reason code, session revocation, audit row and outbox event in one transaction); GET /invitations
  and GET /invitations/{id} with expiry checked on read and a resend link; POST /invitations/{token}/accept refuses
  with 404, 409 and 400, and answers 501 until AC-IDN-43; POST /invitations/{id}/resend answers 501 until AC-IDN-47.
  The session cookie cache is off, and depends-on gains audit. A minimal AuditService (modules/audit) and
  OutboxService (core) came with it, for ROO-23 and ROO-24 to extend
- 2026-10-01 AC-IDN-27 to 58 implemented (ROO-27): users list, deactivate, reactivate and PINs; invitations create
  (by email or SMS through an auth.invite job), resend, revoke, the invite landing and accept for every role (email
  and password, phone and code, or a loader's PIN) with the server-only invitation-session plugin; dock devices;
  settings with depot overrides (SettingsService in core); the demo clock in demo.clock with ClockSync; deferral
  reasons in the planning module; admin gains deferral:read. AC-IDN-59 waits for the S1 seed (ROO-22)
- 2026-10-01 Users and invitations carry `scopeNames` (depot, outlet, vehicle names) for A1's Linked to column;
  GET /users/scope-options feeds A2's Link to select (ROO-27)
- 2026-10-01 Screens A0 Sign in, A1 Users with A2 Invite user and the edit dialog, A6 Settings (with dock tablets, time
  travel and reset), the invite landing and the header demo-time badge built on the generated client (ROO-27).
  Checked against the frames at 1440x960 on the real API; differences are logged in docs/departures.md. The badge
  part of AC-IDN-53 and 55 is checked by screenshot, not by an automated test
- 2026-10-01 The desktop shells' account card became a menu: Sign out everywhere, plus Switch user
  while DEMO_MODE=true, served by `GET /demo/users` and `POST /api/auth/sign-in/demo` (ROO-20
  follow-up). Acceptance criteria for both are still to be written
