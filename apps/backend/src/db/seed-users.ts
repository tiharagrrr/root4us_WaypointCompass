/**
 * The judge personas (specs/identity/spec.md, Permissions): an admin, one
 * account per role and a second driver, plus a dock tablet per depot so a
 * loader can sign in before an admin marks tablets on A6.
 *
 * Accounts are created through BetterAuth's server API, so passwords hash
 * like real ones, and the PIN uses the same hasher. Idempotent: a persona that
 * already exists keeps its id and gets the seed's role, scope, PIN and
 * password again. A depot, outlet or vehicle missing from the reference data
 * leaves that scope empty with a warning.
 */
import type { UserRole } from '@waypoint/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { createAuth } from '../modules/identity/auth/auth';
import type { Database } from './client';
import { accounts, depots, devices, outlets, users, vehicles } from './schema';

interface Persona {
  name: string;
  role: UserRole;
  username: string;
  /** Drivers have none: they get <id>@drivers.waypoint.local. */
  email?: string;
  phoneNumber?: string;
  depotId?: string;
  outletId?: string;
  /** A vehicle code; a driver's depot is the vehicle's. */
  vehicleCode?: string;
  pin?: string;
}

const PERSONAS: Persona[] = [
  {
    name: 'Rusiru Withanage',
    role: 'admin',
    username: 'rusiru.w',
    email: 'rusiru.w@waypoint.lk',
  },
  {
    name: 'Tihara Egodage',
    role: 'dispatcher',
    username: 'tihara.e',
    email: 'tihara.e@waypoint.lk',
  },
  {
    name: 'Nimesha Periyapperuma',
    role: 'store_manager',
    username: 'nimesha.p',
    email: 'nimesha.p@waypoint.lk',
    outletId: 'OUT014',
  },
  {
    name: 'Harini De Mel',
    role: 'loader',
    username: 'harini.d',
    email: 'harini.d@waypoint.lk',
    depotId: 'PLG',
    pin: '2468',
  },
  {
    name: 'Aniqa Razick',
    role: 'driver',
    username: 'aniqa.r',
    phoneNumber: '+94776041932',
    vehicleCode: 'REF-07',
  },
  {
    name: 'Dinushi Rathnayake',
    role: 'driver',
    username: 'dinushi.r',
    phoneNumber: '+94775550107',
    vehicleCode: 'DRY-31',
  },
];

const DOCK_DEVICES = [
  { id: 'dock-plg-01', depotId: 'PLG', label: 'Peliyagoda dock tablet 1' },
  { id: 'dock-kdy-01', depotId: 'KDY', label: 'Kandy dock tablet 1' },
];

const driverEmail = (id: string) => `${id}@drivers.waypoint.local`;

export async function seedUsers(db: Database, password: string): Promise<void> {
  const auth = createAuth({
    db,
    // Hashing needs no secret; this instance never signs a session.
    secret:
      process.env.BETTER_AUTH_SECRET ?? 'seed-only-secret-never-signs-sessions',
    appUrl: process.env.APP_URL ?? 'http://localhost:8080',
    sendOtp: () => Promise.resolve(),
  });
  const { password: hasher } = await auth.$context;

  const known = {
    depots: new Set(
      (await db.select({ id: depots.id }).from(depots)).map((d) => d.id),
    ),
    outlets: new Set(
      (
        await db
          .select({ id: outlets.id })
          .from(outlets)
          .where(
            inArray(
              outlets.id,
              PERSONAS.flatMap((p) => p.outletId ?? []),
            ),
          )
      ).map((o) => o.id),
    ),
    vehicles: new Map(
      (
        await db
          .select({
            id: vehicles.id,
            code: vehicles.code,
            depotId: vehicles.depotId,
          })
          .from(vehicles)
          .where(
            inArray(
              vehicles.code,
              PERSONAS.flatMap((p) => p.vehicleCode ?? []),
            ),
          )
      ).map((v) => [v.code, v]),
    ),
  };
  const exists = <T>(ok: boolean, value: T, what: string): T | null => {
    if (!ok)
      console.warn(`[seed] ${what} is not in the reference data; left empty`);
    return ok ? value : null;
  };

  for (const p of PERSONAS) {
    const vehicle = p.vehicleCode
      ? known.vehicles.get(p.vehicleCode)
      : undefined;
    const depotId = p.depotId ?? vehicle?.depotId;
    const scope = {
      depotId: depotId
        ? exists(known.depots.has(depotId), depotId, `Depot ${depotId}`)
        : null,
      outletId: p.outletId
        ? exists(
            known.outlets.has(p.outletId),
            p.outletId,
            `Outlet ${p.outletId}`,
          )
        : null,
      defaultVehicleId: p.vehicleCode
        ? exists(
            Boolean(vehicle),
            vehicle?.id ?? null,
            `Vehicle ${p.vehicleCode}`,
          )
        : null,
    };

    const [found] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        p.phoneNumber
          ? eq(users.phoneNumber, p.phoneNumber)
          : eq(users.email, p.email!),
      );
    const id =
      found?.id ??
      (
        await auth.api.createUser({
          body: {
            email: p.email ?? driverEmail(`pending-${p.username}`),
            password,
            name: p.name,
            role: p.role,
          },
        })
      ).user.id;

    await db
      .update(users)
      .set({
        name: p.name,
        role: p.role,
        email: p.email ?? driverEmail(id),
        emailVerified: true,
        username: p.username,
        displayUsername: p.username,
        phoneNumber: p.phoneNumber ?? null,
        phoneNumberVerified: p.phoneNumber ? true : null,
        ...scope,
        pinHash: p.pin ? await hasher.hash(p.pin) : null,
        banned: false,
      })
      .where(eq(users.id, id));
    await db
      .update(accounts)
      .set({ password: await hasher.hash(password) })
      .where(
        and(eq(accounts.userId, id), eq(accounts.providerId, 'credential')),
      );
  }

  const docks = DOCK_DEVICES.filter((d) =>
    exists(known.depots.has(d.depotId), true, `Depot ${d.depotId} for ${d.id}`),
  );
  for (const dock of docks) {
    await db
      .insert(devices)
      .values({ ...dock, platform: 'PWA', isDockDevice: true })
      .onConflictDoUpdate({
        target: devices.id,
        set: { depotId: dock.depotId, label: dock.label, isDockDevice: true },
      });
  }

  console.log(
    `[seed] ${PERSONAS.length} persona accounts, ${docks.length} dock devices`,
  );
}
