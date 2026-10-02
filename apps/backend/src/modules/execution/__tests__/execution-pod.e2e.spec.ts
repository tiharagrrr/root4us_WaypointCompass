import { eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import { attachments } from '../../../db/schema';
import {
  at,
  auditRows,
  buildWorld,
  call,
  data,
  resetTrips,
  seedTrip,
  setOrderStatus,
  tearDownWorld,
  type World,
} from './execution.world';

interface AttachmentBody {
  id: string;
  kind: string;
  owner: { type: string; id: string };
  uploadedAt: string | null;
  upload?: { url: string; method: string; expiresAt: string };
  _links: Record<string, { href: string }>;
}

describeWithDb('execution: proof of delivery', () => {
  let world: World;

  beforeAll(async () => {
    world = await buildWorld();
  });

  afterAll(async () => {
    await tearDownWorld(world);
  });

  beforeEach(async () => {
    await resetTrips(world);
    await world.db.delete(attachments).where(eq(attachments.ownerType, 'stop'));
  });

  it('AC-EXE-16 proof of delivery by presigned URL', async () => {
    const trip = await seedTrip(world, {
      tripNo: 1,
      status: 'IN_PROGRESS',
      stopStatus: 'ARRIVED',
      stops: 1,
    });
    await setOrderStatus(world, trip.orderIds[0], 'IN_TRANSIT');
    const signatureUuid = crypto.randomUUID();

    // The delivery names its signature by the clientUuid the phone made.
    at(world, '2026-10-02T04:20:00+05:30');
    const delivered = await call(
      world,
      'aniqa',
      'post',
      `/stops/${trip.stopIds[0]}/complete`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T04:20:00+05:30',
      outcome: 'DELIVERED',
      receiverName: 'K. Fernando',
      attachmentUuids: [signatureUuid],
    });
    expect(delivered.status).toBe(200);

    at(world, '2026-10-02T04:21:00+05:30');
    const body = {
      kind: 'SIGNATURE',
      contentType: 'image/png',
      bytes: 48_120,
      sha256: 'c'.repeat(64),
      clientUuid: signatureUuid,
      owner: { type: 'stop', id: trip.stopIds[0] },
    };

    const res = await call(world, 'aniqa', 'post', '/attachments/presign').send(
      body,
    );
    expect(res.status).toBe(200);
    const attachment = data<AttachmentBody>(res);

    // An upload URL that expires ten minutes from now, and nothing uploaded yet.
    expect(attachment.upload?.method).toBe('PUT');
    expect(attachment.upload?.url).toContain('http');
    expect(new Date(attachment.upload!.expiresAt)).toEqual(
      new Date('2026-10-02T04:31:00+05:30'),
    );
    expect(attachment.uploadedAt).toBeNull();
    expect(attachment.owner).toEqual({ type: 'stop', id: trip.stopIds[0] });
    expect(attachment._links.complete).toBeDefined();

    // The same clientUuid again: the same attachment, and no second row.
    const again = await call(
      world,
      'aniqa',
      'post',
      '/attachments/presign',
    ).send(body);
    expect(again.status).toBe(200);
    expect(data<AttachmentBody>(again).id).toBe(attachment.id);
    const rows = await world.db
      .select()
      .from(attachments)
      .where(eq(attachments.clientUuid, signatureUuid));
    expect(rows).toHaveLength(1);
    expect(
      await auditRows(world, 'execution.attachment.presigned', attachment.id),
    ).toHaveLength(1);

    // The upload itself goes straight to the store with that URL, never
    // through the API (test/setup-env.ts keeps the suites off a real bucket;
    // TEST_S3_ENDPOINT runs the same criterion against Garage).
    // Confirming it is what makes the file count as proof.
    const completed = await call(
      world,
      'aniqa',
      'post',
      `/attachments/${attachment.id}/complete`,
    ).send({});
    expect(completed.status).toBe(200);
    expect(data<AttachmentBody>(completed).uploadedAt).not.toBeNull();
    expect(
      (
        await world.db
          .select()
          .from(attachments)
          .where(eq(attachments.id, attachment.id))
      )[0].uploadedAt,
    ).toEqual(new Date('2026-10-02T04:21:00+05:30'));

    // The store manager of this outlet opens it: a link to the store that
    // lasts five minutes, and bytes that never pass through the API.
    const open = await call(
      world,
      'store',
      'get',
      `/attachments/${attachment.id}`,
    );
    expect(open.status).toBe(200);
    const link = data<{ url: string; expiresAt: string }>(open);
    expect(new Date(link.expiresAt)).toEqual(
      new Date('2026-10-02T04:26:00+05:30'),
    );
    expect(new URL(link.url).hostname).not.toBe('127.0.0.1');

    // A store manager of another outlet learns nothing.
    const other = await call(
      world,
      'otherStore',
      'get',
      `/attachments/${attachment.id}`,
    );
    expect(other.status).toBe(404);
    expect(expectProblem(other, 'NOT_FOUND').detail).toBe(
      'The attachment was not found.',
    );
  });

  it('AC-EXE-16 a file over the limit is refused before any row exists', async () => {
    const trip = await seedTrip(world, {
      tripNo: 1,
      status: 'IN_PROGRESS',
      stopStatus: 'ARRIVED',
      stops: 1,
    });
    at(world, '2026-10-02T04:21:00+05:30');

    const res = await call(world, 'aniqa', 'post', '/attachments/presign').send(
      {
        kind: 'POD_PHOTO',
        contentType: 'image/jpeg',
        bytes: 6 * 1024 * 1024,
        clientUuid: crypto.randomUUID(),
        owner: { type: 'stop', id: trip.stopIds[0] },
      },
    );
    expect(res.status).toBe(413);
    expectProblem(res, 'PAYLOAD_TOO_LARGE');
    expect(
      await world.db
        .select()
        .from(attachments)
        .where(eq(attachments.ownerType, 'stop')),
    ).toHaveLength(0);
  });

  it("AC-EXE-16 a driver cannot attach to another driver's stop", async () => {
    const hers = await seedTrip(world, {
      vehicle: 'dry',
      driver: 'dinushi',
      tempClass: 'AMBIENT',
      tripNo: 1,
      status: 'IN_PROGRESS',
      stopStatus: 'ARRIVED',
      stops: 1,
    });
    at(world, '2026-10-02T04:21:00+05:30');

    const res = await call(world, 'aniqa', 'post', '/attachments/presign').send(
      {
        kind: 'POD_PHOTO',
        contentType: 'image/jpeg',
        bytes: 1024,
        clientUuid: crypto.randomUUID(),
        owner: { type: 'stop', id: hers.stopIds[0] },
      },
    );
    expect(res.status).toBe(404);
    expect(
      await world.db
        .select()
        .from(attachments)
        .where(eq(attachments.ownerType, 'stop')),
    ).toHaveLength(0);
  });
});
