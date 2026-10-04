import { createHash, randomBytes, randomInt } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { InvitationStatus, Link, UserRole } from '@waypoint/shared';
import type { Job, Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { bodyOf, browser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import {
  depotFixture,
  outletFixture,
  suffix,
  vehicleFixture,
} from '../../../../test/fixtures';
import { expectProblem } from '../../../../test/kernel';
import { ClockService } from '../../../core/clock/clock.service';
import type { DemoInbox, DemoMessage } from '../../../core/demo/demo-inbox';
import type { Database } from '../../../db/client';
import {
  accounts,
  auditEvents,
  invitations,
  outboxEvents,
  users,
  verifications,
} from '../../../db/schema';
import { QUEUES } from '../../../queues';
import { NotificationsProcessor } from '../../../worker/notifications.processor';
import type { Auth } from '../auth/auth';
import { AUTH } from '../auth/auth.module';
import { AUTH_INVITE_JOB, type AuthInviteJob } from '../auth/auth-messages';

interface InvitationBody {
  id: string;
  name: string;
  role: string;
  status: string;
  expiresAt: string;
  _links: Record<string, Link>;
}

interface FieldErrors {
  errors: { field: string; code: string }[];
}

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');
const phone = () => `+9477${randomInt(1_000_000, 10_000_000)}`;

describeWithDb('/invitations', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  let kadawatha: string;
  let rusiru: Awaited<ReturnType<typeof signedInAs>>;

  /** Pins ClockService.realNow(), which token expiry reads. */
  const realTimeIs = (at: string) =>
    jest.spyOn(app.get(ClockService), 'realNow').mockReturnValue(new Date(at));

  const admin = () => {
    const server = app.getHttpServer();
    const signedIn = <T extends request.Test>(r: T) =>
      r.set(browser()).set('Cookie', rusiru.cookie);
    return {
      get: (path: string) => signedIn(request(server).get(path)),
      post: (path: string, body: object = {}) =>
        signedIn(request(server).post(path)).send(body),
    };
  };
  const anyone = () => {
    const server = app.getHttpServer();
    return {
      get: (path: string) => request(server).get(path).set(browser()),
      post: (path: string, body: object) =>
        request(server).post(path).set(browser()).send(body),
    };
  };

  /** An invitation row with a token the test knows. */
  async function insertInvitation(input: {
    role: UserRole;
    email?: string;
    phoneNumber?: string;
    depotId?: string;
    outletId?: string;
    createdAt: string;
    status?: InvitationStatus;
  }) {
    const token = randomBytes(32).toString('base64url');
    const createdAt = new Date(input.createdAt);
    const [invitation] = await db
      .insert(invitations)
      .values({
        name: `Invitee ${suffix()}`,
        role: input.role,
        email: input.email ?? null,
        phoneNumber: input.phoneNumber ?? null,
        depotId: input.depotId ?? null,
        outletId: input.outletId ?? null,
        tokenHash: sha256(token),
        status: input.status ?? 'PENDING',
        createdAt,
        sentAt: createdAt,
        expiresAt: new Date(createdAt.getTime() + 72 * 3_600_000),
        invitedById: rusiru.id,
      })
      .returning();
    return { invitation, token };
  }

  const invitationRow = async (id: string) =>
    (await db.select().from(invitations).where(eq(invitations.id, id)))[0];
  const usersWithEmail = (email: string) =>
    db.$count(users, eq(users.email, email));
  const auditsFor = (type: string, id: string) =>
    db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityType, type), eq(auditEvents.entityId, id)),
      );
  const eventsFor = (type: string, id: string) =>
    db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateType, type),
          eq(outboxEvents.aggregateId, id),
        ),
      );

  /** The invite delivery job the API queued for an invitation (no worker runs in tests). */
  async function inviteJobs(invitationId: string) {
    const queue = app.get<Queue>(getQueueToken(QUEUES.notifications));
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    return jobs.filter(
      (j): j is Job<AuthInviteJob> =>
        j.name === AUTH_INVITE_JOB &&
        (j.data as AuthInviteJob).invitationId === invitationId,
    );
  }
  const tokenOf = (job: Job<AuthInviteJob>) =>
    job.data.link.split('/invite/')[1];

  /** What the worker would put in the demo inbox for a job. */
  async function deliver(job: Job<AuthInviteJob>) {
    const messages: Omit<DemoMessage, 'id'>[] = [];
    const inbox = {
      enabled: true,
      push: (m: Omit<DemoMessage, 'id'>) => {
        messages.push(m);
        return Promise.resolve();
      },
    } as unknown as DemoInbox;
    // Only the auth jobs run here; notify.send's collaborators are not needed.
    await new NotificationsProcessor(
      inbox,
      {} as ConstructorParameters<typeof NotificationsProcessor>[1],
      {} as ConstructorParameters<typeof NotificationsProcessor>[2],
    ).process(job);
    return messages;
  }

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    kadawatha = await outletFixture(db, `OUT014-${sfx}`, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
    });
    rusiru = await signedInAs(app, db, {
      role: 'admin',
      name: 'Rusiru Withanage',
    });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await close();
    await app.close();
  });

  it('AC-IDN-03 late invitation acceptance gets 409', async () => {
    const phoneNumber = phone();
    const { invitation, token } = await insertInvitation({
      role: 'driver',
      phoneNumber,
      depotId: depot.plg,
      createdAt: '2026-09-30T09:00:00+05:30',
    });
    realTimeIs('2026-10-03T09:00:01+05:30');

    const res = await anyone().post(`/api/v1/invitations/${token}/accept`, {
      phoneNumber,
      code: '123456',
    });
    expect(res.status).toBe(409);
    expectProblem(res, 'CONFLICT_STATE');

    expect(await db.$count(users, eq(users.phoneNumber, phoneNumber))).toBe(0);
    const stored = await invitationRow(invitation.id);
    expect(stored.status).not.toBe('ACCEPTED');
    expect(stored).toMatchObject({ acceptedAt: null, userId: null });

    const list = await admin()
      .get(`/api/v1/invitations?q=${encodeURIComponent(invitation.name)}`)
      .expect(200);
    const listed = bodyOf<{ data: InvitationBody[] }>(list).data;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: invitation.id,
      status: 'EXPIRED',
      expiresAt: '2026-10-03T09:00:00+05:30',
    });
    expect(listed[0]._links.resend).toMatchObject({
      href: `/api/v1/invitations/${invitation.id}/resend`,
      method: 'POST',
    });
  });

  it('AC-IDN-39 admin invites a driver', async () => {
    realTimeIs('2026-09-30T10:00:00+05:30');
    const phoneNumber = phone();
    const vehicleId = await vehicleFixture(db, `DRY-${suffix()}`, depot.plg);

    const res = await admin()
      .post('/api/v1/invitations', {
        name: 'Kasun Perera',
        role: 'driver',
        depotId: depot.plg,
        phoneNumber,
        vehicleId,
      })
      .set('Idempotency-Key', `K-${suffix()}`)
      .expect(201);
    const created = bodyOf<{ data: InvitationBody }>(res).data;
    expect(res.headers.location).toBe(`/api/v1/invitations/${created.id}`);
    expect(created).toMatchObject({
      status: 'PENDING',
      expiresAt: '2026-10-03T10:00:00+05:30',
    });

    const [job] = await inviteJobs(created.id);
    const token = tokenOf(job);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const row = await invitationRow(created.id);
    expect(row.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);

    expect(
      (await auditsFor('invitation', created.id)).map((a) => a.action),
    ).toEqual(['identity.invitation.created']);
    const events = await eventsFor('invitation', created.id);
    expect(events.map((e) => e.type)).toEqual(['identity.user.invited']);
    expect(JSON.stringify(events[0].payload)).not.toContain(phoneNumber);
    expect(JSON.stringify(events[0].payload)).not.toContain(token);

    // Drivers are invited by SMS: the worker puts it in the demo inbox.
    const [sms] = await deliver(job);
    expect(sms).toMatchObject({ channel: 'sms', to: phoneNumber });
    expect(sms.body).toContain(`/invite/${token}`);
    await job.remove();
  });

  it('AC-IDN-40 invitation create is idempotent', async () => {
    const phoneNumber = phone();
    const key = `K1-${suffix()}`;
    const body = {
      name: 'Kasun Perera',
      role: 'driver',
      depotId: depot.plg,
      phoneNumber,
    };
    const first = await admin()
      .post('/api/v1/invitations', body)
      .set('Idempotency-Key', key)
      .expect(201);
    const again = await admin()
      .post('/api/v1/invitations', body)
      .set('Idempotency-Key', key)
      .expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const id = bodyOf<{ data: InvitationBody }>(first).data.id;
    expect(bodyOf<{ data: InvitationBody }>(again).data.id).toBe(id);

    expect(
      await db.$count(invitations, eq(invitations.phoneNumber, phoneNumber)),
    ).toBe(1);
    expect(await auditsFor('invitation', id)).toHaveLength(1);
    expect(await eventsFor('invitation', id)).toHaveLength(1);
    for (const job of await inviteJobs(id)) await job.remove();
  });

  it('AC-IDN-41 invitation scope follows the role', async () => {
    const refused = [
      [
        { role: 'store_manager', email: `sm-${suffix()}@waypoint.lk` },
        'outletId',
      ],
      [{ role: 'loader', email: `ld-${suffix()}@waypoint.lk` }, 'depotId'],
      [{ role: 'driver', depotId: depot.plg }, 'phoneNumber'],
    ] as const;
    for (const [fields, field] of refused) {
      const name = `Refused ${suffix()}`;
      const res = await admin().post('/api/v1/invitations', {
        name,
        ...fields,
      });
      expect(res.status).toBe(400);
      const problem = expectProblem(
        res,
        'VALIDATION_FAILED',
      ) as unknown as FieldErrors;
      expect(problem.errors.map((e) => e.field)).toContain(field);
      expect(await db.$count(invitations, eq(invitations.name, name))).toBe(0);
    }

    const dispatcher = await admin()
      .post('/api/v1/invitations', {
        name: 'Tihara Egodage',
        role: 'dispatcher',
        email: `dp-${suffix()}@waypoint.lk`,
      })
      .expect(201);
    const id = bodyOf<{ data: InvitationBody }>(dispatcher).data.id;
    for (const job of await inviteJobs(id)) await job.remove();
  });

  it('AC-IDN-42 invite landing shows name and expiry', async () => {
    const { invitation, token } = await insertInvitation({
      role: 'store_manager',
      email: `nimesha-${suffix()}@waypoint.lk`,
      outletId: kadawatha,
      createdAt: '2026-09-30T10:00:00+05:30',
    });
    realTimeIs('2026-10-01T09:00:00+05:30');

    const res = await anyone()
      .get(`/api/v1/invitations/by-token/${token}`)
      .expect(200);
    expect(bodyOf<{ data: InvitationBody }>(res).data).toMatchObject({
      name: invitation.name,
      role: 'store_manager',
      expiresAt: '2026-10-03T10:00:00+05:30',
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('AC-IDN-43 accepting creates the user', async () => {
    const email = `nimesha-${suffix()}@waypoint.lk`;
    const { invitation, token } = await insertInvitation({
      role: 'store_manager',
      email,
      outletId: kadawatha,
      createdAt: '2026-09-30T10:00:00+05:30',
    });
    realTimeIs('2026-10-01T09:00:00+05:30');

    const res = await anyone()
      .post(`/api/v1/invitations/${token}/accept`, {
        email,
        password: 'kadawatha-12',
      })
      .expect(200);

    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user).toMatchObject({ role: 'store_manager', outletId: kadawatha });
    // Created through BetterAuth: a credential account with a hashed password.
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, user.id));
    expect(account.providerId).toBe('credential');
    const ctx = await app.get<Auth>(AUTH).$context;
    expect(
      await ctx.password.verify({
        hash: account.password!,
        password: 'kadawatha-12',
      }),
    ).toBe(true);

    expect(await invitationRow(invitation.id)).toMatchObject({
      status: 'ACCEPTED',
      userId: user.id,
      acceptedAt: new Date('2026-10-01T09:00:00+05:30'),
    });

    const cookie = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set(browser())
      .set('Cookie', cookie)
      .expect(200);
    expect(bodyOf<{ data: { id: string } }>(me).data.id).toBe(user.id);

    expect((await eventsFor('user', user.id)).map((e) => e.type)).toEqual([
      'identity.user.joined',
    ]);
  });

  it('AC-IDN-44 accept refuses a mismatched email', async () => {
    const email = `nimesha-${suffix()}@waypoint.lk`;
    const other = `someone-${suffix()}@waypoint.lk`;
    const { invitation, token } = await insertInvitation({
      role: 'store_manager',
      email,
      outletId: kadawatha,
      createdAt: '2026-09-30T10:00:00+05:30',
    });
    realTimeIs('2026-10-01T09:00:00+05:30');

    const res = await anyone().post(`/api/v1/invitations/${token}/accept`, {
      email: other,
      password: 'kadawatha-12',
    });
    expect(res.status).toBe(400);
    const problem = expectProblem(
      res,
      'VALIDATION_FAILED',
    ) as unknown as FieldErrors;
    expect(problem.errors.map((e) => e.field)).toEqual(['email']);

    expect(await usersWithEmail(email)).toBe(0);
    expect(await usersWithEmail(other)).toBe(0);
    expect((await invitationRow(invitation.id)).status).toBe('PENDING');
  });

  it('AC-IDN-45 a used invitation cannot be reused', async () => {
    const email = `nimesha-${suffix()}@waypoint.lk`;
    const { token } = await insertInvitation({
      role: 'store_manager',
      email,
      outletId: kadawatha,
      createdAt: '2026-09-30T10:00:00+05:30',
    });
    realTimeIs('2026-10-01T09:00:00+05:30');
    const accept = () =>
      anyone().post(`/api/v1/invitations/${token}/accept`, {
        email,
        password: 'kadawatha-12',
      });
    await accept().expect(200);

    const again = await accept();
    expect(again.status).toBe(409);
    expectProblem(again, 'CONFLICT_STATE');
    expect(await usersWithEmail(email)).toBe(1);
  });

  it('AC-IDN-46 driver accepts with an SMS code', async () => {
    const phoneNumber = phone();
    const { invitation, token } = await insertInvitation({
      role: 'driver',
      phoneNumber,
      depotId: depot.plg,
      createdAt: '2026-09-30T10:00:00+05:30',
    });
    realTimeIs('2026-10-01T09:00:00+05:30');

    await anyone()
      .post('/api/auth/phone-number/send-otp', { phoneNumber })
      .expect(200);
    const [otp] = await db
      .select({ value: verifications.value })
      .from(verifications)
      .where(eq(verifications.identifier, phoneNumber));
    const code = otp.value.split(':')[0];

    const res = await anyone()
      .post(`/api/v1/invitations/${token}/accept`, { phoneNumber, code })
      .expect(200);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.phoneNumber, phoneNumber));
    expect(user).toMatchObject({
      role: 'driver',
      depotId: depot.plg,
      phoneNumberVerified: true,
      email: `${user.id}@drivers.waypoint.local`,
    });
    expect(await invitationRow(invitation.id)).toMatchObject({
      status: 'ACCEPTED',
      userId: user.id,
    });
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('session_token=')]),
    );
  });

  it('AC-IDN-47 resend issues a new token', async () => {
    const phoneNumber = phone();
    const { invitation, token: oldToken } = await insertInvitation({
      role: 'driver',
      phoneNumber,
      depotId: depot.plg,
      createdAt: '2026-09-30T09:00:00+05:30',
    });
    realTimeIs('2026-10-03T10:00:00+05:30');

    const res = await admin()
      .post(`/api/v1/invitations/${invitation.id}/resend`)
      .expect(200);
    expect(bodyOf<{ data: InvitationBody }>(res).data).toMatchObject({
      status: 'PENDING',
      expiresAt: '2026-10-06T10:00:00+05:30',
    });
    const row = await invitationRow(invitation.id);
    expect(row.status).toBe('PENDING');
    expect(row.tokenHash).not.toBe(invitation.tokenHash);

    const [job] = await inviteJobs(invitation.id);
    expect(row.tokenHash).toBe(sha256(tokenOf(job)));
    const [sms] = await deliver(job);
    expect(sms).toMatchObject({ channel: 'sms', to: phoneNumber });
    await job.remove();

    const old = await anyone().get(`/api/v1/invitations/by-token/${oldToken}`);
    expect(old.status).toBe(404);
    expectProblem(old, 'NOT_FOUND');
    expect(
      (await auditsFor('invitation', invitation.id)).map((a) => a.action),
    ).toEqual(['identity.invitation.resent']);
  });

  it('AC-IDN-48 revoked invitation cannot be accepted', async () => {
    const email = `revoked-${suffix()}@waypoint.lk`;
    const { invitation, token } = await insertInvitation({
      role: 'dispatcher',
      email,
      createdAt: '2026-09-30T10:00:00+05:30',
    });
    realTimeIs('2026-10-01T09:00:00+05:30');

    const revoked = await admin()
      .post(`/api/v1/invitations/${invitation.id}/revoke`)
      .expect(200);
    expect(bodyOf<{ data: InvitationBody }>(revoked).data.status).toBe(
      'REVOKED',
    );

    const res = await anyone().post(`/api/v1/invitations/${token}/accept`, {
      email,
      password: 'dispatcher-12',
    });
    expect(res.status).toBe(409);
    expectProblem(res, 'CONFLICT_STATE');
    expect(await usersWithEmail(email)).toBe(0);
  });

  it('keeps the session endpoint for invitees off HTTP', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/invitation/session')
      .set(browser())
      .send({ userId: uuidv7() });
    expect(res.status).toBe(404);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
