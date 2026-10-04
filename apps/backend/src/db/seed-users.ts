/**
 * The judge personas (specs/identity/spec.md, Permissions): an admin, one
 * account per role and a second driver, plus a dock tablet per depot so a
 * loader can sign in before an admin marks tablets on A6.
 *
 * After the personas, every vehicle and outlet without a person gets a
 * synthetic driver or store manager (seedStaff), so assignments and plans
 * have people to pick.
 *
 * Accounts are created through BetterAuth's server API, so passwords hash
 * like real ones, and the PIN uses the same hasher. Idempotent: a persona that
 * already exists keeps its id and gets the seed's role, scope and password
 * again; a loader keeps the PIN they hold, and gets the seed's only when they
 * have none. A depot, outlet or vehicle missing from the reference data leaves
 * that scope empty with a warning.
 */
import type { UserRole } from '@waypoint/shared';
import { and, eq, inArray, like } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { createAuth } from '../modules/identity/auth/auth';
import { isSeededStaff } from '../modules/identity/domain/seeded-staff';
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
    name: 'Kasun Bandara',
    role: 'loader',
    username: 'kasun.b',
    email: 'kasun.b@waypoint.lk',
    depotId: 'KDY',
    pin: '1357',
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
      .select({
        id: users.id,
        pinHash: users.pinHash,
        demoPin: users.demoPin,
      })
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

    // The PIN in clear for A1, only while DEMO_MODE=true: the copy the loader
    // already has, or the seed's PIN when that is the one they hold.
    const demoPinOf = async (
      pin: string | undefined,
      held: typeof found,
    ): Promise<string | null> => {
      if (!pin || process.env.DEMO_MODE !== 'true') return null;
      if (!held?.pinHash) return pin;
      if (held.demoPin) return held.demoPin;
      const seeded = await hasher.verify({
        hash: held.pinHash,
        password: pin,
      });
      return seeded ? pin : null;
    };

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
        // A PIN an admin has set since (PUT /users/{id}/pin) stays: the seed
        // runs on every deploy and would otherwise undo the change.
        pinHash: p.pin ? (found?.pinHash ?? (await hasher.hash(p.pin))) : null,
        demoPin: await demoPinOf(p.pin, found),
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

  await seedStaff(db, auth, await hasher.hash(password));
}

const FIRST_NAMES = [
  'Amal',
  'Chamari',
  'Dilan',
  'Fathima',
  'Gayan',
  'Hasini',
  'Isuru',
  'Janani',
  'Kavindu',
  'Lakmini',
  'Malith',
  'Nadeesha',
  'Pradeep',
  'Rashmi',
  'Sahan',
  'Thilini',
  'Udara',
  'Vihanga',
  'Yasith',
  'Zainab',
  'Ruwan',
  'Sachini',
  'Kumar',
  'Priya',
];
const LAST_NAMES = [
  'Perera',
  'Fernando',
  'Silva',
  'Jayasinghe',
  'Wickramasinghe',
  'Bandara',
  'Herath',
  'Gunawardena',
  'Rajapaksha',
  'Dissanayake',
  'Senanayake',
  'Nawaz',
  'Kumarasamy',
  'Ekanayake',
  'Abeysekara',
  'Liyanage',
  'Ratnayake',
];

/** A stable made-up name for the n-th staff account. */
const staffName = (n: number) =>
  `${FIRST_NAMES[n % FIRST_NAMES.length]} ${LAST_NAMES[(n * 7 + 3) % LAST_NAMES.length]}`;

type SeedAuth = ReturnType<typeof createAuth>;

interface StaffMember {
  name: string;
  role: 'driver' | 'store_manager';
  username: string;
  email?: string;
  depotId: string;
  outletId?: string;
  defaultVehicleId?: string;
}

/**
 * A synthetic driver for every vehicle and a store manager for every outlet
 * that no persona or admin-linked person covers (ROO-76). Both are keyed by
 * username (drv.<vehicle code>, mgr.<outlet id>). Drivers sign in by code on
 * a synthetic +947000 phone they keep across runs; store managers share the
 * seed password.
 * Idempotent: a re-run keeps each id and resets name, scope and password.
 */
export async function seedStaff(
  db: Database,
  auth: SeedAuth,
  passwordHash: string,
): Promise<void> {
  const linked = await db
    .select({
      username: users.username,
      vehicleId: users.defaultVehicleId,
      outletId: users.outletId,
      role: users.role,
    })
    .from(users);
  const people = linked.filter((u) => !isSeededStaff(u.username));
  const driven = new Set(
    people.filter((u) => u.role === 'driver').flatMap((u) => u.vehicleId ?? []),
  );
  const managed = new Set(
    people
      .filter((u) => u.role === 'store_manager')
      .flatMap((u) => u.outletId ?? []),
  );

  const fleet = await db
    .select({ id: vehicles.id, code: vehicles.code, depotId: vehicles.depotId })
    .from(vehicles)
    .orderBy(vehicles.id);
  const shops = await db
    .select({ id: outlets.id, depotId: outlets.depotId })
    .from(outlets)
    .orderBy(outlets.id);

  const staff: StaffMember[] = [];
  fleet.forEach((v, i) => {
    if (driven.has(v.id)) return;
    staff.push({
      name: staffName(i),
      role: 'driver',
      username: `drv.${v.code.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      depotId: v.depotId,
      defaultVehicleId: v.id,
    });
  });
  shops.forEach((o, i) => {
    if (managed.has(o.id)) return;
    const username = `mgr.${o.id.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    staff.push({
      name: staffName(i + 11),
      role: 'store_manager',
      username,
      email: `${username}@waypoint.lk`,
      depotId: o.depotId,
      outletId: o.id,
    });
  });

  // A seeded driver whose vehicle now has a persona or an admin-linked driver
  // lets go of it, so every vehicle keeps exactly one.
  const staffDrivers = await db
    .select({ id: users.id, vehicleId: users.defaultVehicleId })
    .from(users)
    .where(like(users.username, 'drv.%'));
  const released = staffDrivers.filter(
    (u) => u.vehicleId && driven.has(u.vehicleId),
  );
  if (released.length)
    await db
      .update(users)
      .set({ defaultVehicleId: null })
      .where(
        inArray(
          users.id,
          released.map((u) => u.id),
        ),
      );

  const existing = new Map(
    (
      await db
        .select({
          id: users.id,
          username: users.username,
          phoneNumber: users.phoneNumber,
        })
        .from(users)
        .where(
          inArray(
            users.username,
            staff.map((s) => s.username),
          ),
        )
    ).map((u) => [u.username, u]),
  );
  const withPassword = new Set(
    (
      await db
        .select({ userId: accounts.userId })
        .from(accounts)
        .where(eq(accounts.providerId, 'credential'))
    ).map((a) => a.userId),
  );

  // A new driver takes the next +947000 number nobody has.
  const phones = new Set(
    (
      await db
        .select({ phoneNumber: users.phoneNumber })
        .from(users)
        .where(like(users.phoneNumber, '+947000%'))
    ).flatMap((u) => u.phoneNumber ?? []),
  );
  let nextPhone = 1;
  const freePhone = () => {
    let phone: string;
    do phone = `+947000${String(nextPhone++).padStart(5, '0')}`;
    while (phones.has(phone));
    phones.add(phone);
    return phone;
  };

  for (const s of staff) {
    const found = existing.get(s.username);
    const phoneNumber =
      s.role === 'driver' ? (found?.phoneNumber ?? freePhone()) : null;
    // No password here: creating one would hash it 180 times. Store managers
    // get the seed password's hash below; drivers sign in by phone.
    const id =
      found?.id ??
      (
        await auth.api.createUser({
          body: {
            email: s.email ?? driverEmail(`pending-${s.username}`),
            name: s.name,
            role: s.role,
          },
        })
      ).user.id;

    await db
      .update(users)
      .set({
        name: s.name,
        role: s.role,
        email: s.email ?? driverEmail(id),
        emailVerified: true,
        username: s.username,
        displayUsername: s.username,
        phoneNumber,
        phoneNumberVerified: phoneNumber ? true : null,
        depotId: s.depotId,
        outletId: s.outletId ?? null,
        defaultVehicleId: s.defaultVehicleId ?? null,
        pinHash: null,
        banned: false,
      })
      .where(eq(users.id, id));

    if (s.role !== 'store_manager') continue;
    if (withPassword.has(id))
      await db
        .update(accounts)
        .set({ password: passwordHash })
        .where(
          and(eq(accounts.userId, id), eq(accounts.providerId, 'credential')),
        );
    else
      await db.insert(accounts).values({
        id: uuidv7(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: passwordHash,
      });
  }

  const drivers = staff.filter((s) => s.role === 'driver').length;
  console.log(
    `[seed] ${drivers} fleet drivers, ${staff.length - drivers} outlet store managers`,
  );
}
