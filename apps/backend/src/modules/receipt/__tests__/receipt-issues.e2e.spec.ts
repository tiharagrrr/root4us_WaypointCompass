import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import { attachments, issues } from '../../../db/schema';
import type { CommentDto, IssueDto } from '../dto/issue.dto';
import {
  at,
  auditRows,
  buildWorld,
  call,
  commentRows,
  data,
  issueRows,
  orderRow,
  outboxRows,
  resetDeliveries,
  seedDelivery,
  seedIssue,
  tearDownWorld,
  type World,
} from './receipt.world';

/**
 * Issues and their thread (specs/receipt/spec.md, AC-RCP-10 to 14). Each test is one
 * criterion, named after it.
 *
 * Not asserted here, because other modules own them: the STORE_ISSUE alert that
 * `issue.resolved` clears (alerts), and the push, in-app and email notices and the SSE
 * delivery of a comment (notifications and realtime). The events they consume are checked.
 */
describeWithDb('receipt: issues', () => {
  jest.setTimeout(60_000);

  let world: World;

  beforeAll(async () => {
    world = await buildWorld();
  });

  afterAll(async () => {
    await tearDownWorld(world);
  });

  beforeEach(async () => {
    await resetDeliveries(world);
  });

  const issue = (res: { body: unknown }) =>
    (res.body as { data: IssueDto }).data;

  it('AC-RCP-10 report an issue after receipt', async () => {
    const seeded = await seedDelivery(world, {
      orderStatus: 'RECEIVED',
      version: 9,
    });
    at(world, '2026-10-02T10:30:00+05:30');

    const res = await call(world, 'store', 'post', '/issues', {
      ifMatch: 9,
      key: 'k-issue',
      body: {
        orderId: seeded.orderId,
        type: 'DAMAGED',
        qtyAffected: 3,
        description: '3 trays damaged',
      },
    });

    expect(res.status).toBe(201);
    const created = issue(res);
    expect(res.headers.location).toBe(`/api/v1/issues/${created.id}`);
    expect(created).toMatchObject({
      status: 'OPEN',
      raisedByRole: 'store_manager',
      outletId: world.kadawatha,
      orderId: seeded.orderId,
      orderNo: seeded.orderNo,
      type: 'DAMAGED',
      qtyAffected: 3,
    });
    expect((await orderRow(world, seeded.orderId)).status).toBe(
      'ISSUE_REPORTED',
    );
    const [audit, ...moreAudit] = await auditRows(
      world,
      'receipt.issue.reported',
    );
    expect(moreAudit).toHaveLength(0);
    expect(audit.reasonCode).toBe('DAMAGED');
    const events = await outboxRows(world, 'issue.reported');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      issueId: created.id,
      type: 'DAMAGED',
      outletId: world.kadawatha,
    });

    // One photo, uploaded as an ISSUE_PHOTO attachment owned by the issue.
    const presign = await call(
      world,
      'store',
      'post',
      `/issues/${created.id}/attachments/presign`,
      {
        body: {
          contentType: 'image/jpeg',
          bytes: 48_120,
          clientUuid: randomUUID(),
        },
      },
    );
    expect(presign.status).toBe(200);
    const photo = data<{ id: string; uploadUrl: string }>(presign);
    expect(photo.uploadUrl).toMatch(/^https?:\/\//);
    const [row] = await world.db
      .select()
      .from(attachments)
      .where(eq(attachments.id, photo.id));
    expect(row).toMatchObject({
      kind: 'ISSUE_PHOTO',
      ownerType: 'issue',
      ownerId: created.id,
    });

    // Once the file is in the store, the issue lists it and a link opens it for five minutes.
    await world.db
      .update(attachments)
      .set({ uploadedAt: new Date('2026-10-02T10:31:00+05:30') })
      .where(eq(attachments.id, photo.id));
    const detail = await call(world, 'store', 'get', `/issues/${created.id}`);
    expect(issue(detail).photos.map((p) => p.id)).toEqual([photo.id]);
    const link = await call(
      world,
      'store',
      'get',
      `/issues/${created.id}/attachments/${photo.id}`,
    );
    expect(link.status).toBe(200);
    expect(data<{ expiresAt: string }>(link).expiresAt).toBe(
      new Date('2026-10-02T10:35:00+05:30').toISOString(),
    );
  });

  it('AC-RCP-11 issues are scoped', async () => {
    const seeded = await seedDelivery(world);
    const mine = await seedIssue(world, {
      orderId: seeded.orderId,
      stopId: seeded.stopId,
    });
    const kandy = await seedIssue(world, { outletId: world.kandyOutlet });
    const both = `${world.kadawatha},${world.kandyOutlet}`;

    const store = await call(world, 'store', 'get', '/issues?limit=100');
    expect(store.status).toBe(200);
    expect(data<IssueDto[]>(store).map((i) => i.id)).toEqual([mine]);
    expect(
      (store.body as { meta: { page: { total: number } } }).meta.page.total,
    ).toBe(1);

    const tihara = await call(
      world,
      'dispatcher',
      'get',
      `/issues?filter[outletId]=${both}&limit=100`,
    );
    expect(
      data<IssueDto[]>(tihara)
        .map((i) => i.id)
        .sort(),
    ).toEqual([mine, kandy].sort());

    const scoped = await call(
      world,
      'kandyDispatcher',
      'get',
      `/issues/${mine}`,
    );
    expect(scoped.status).toBe(404);
    expectProblem(scoped, 'NOT_FOUND');
    expect(
      (await call(world, 'kandyDispatcher', 'get', `/issues/${kandy}`)).status,
    ).toBe(200);

    for (const path of ['/issues', `/issues/${mine}`]) {
      const res = await call(world, 'driver', 'get', path);
      expect(res.status).toBe(403);
      expectProblem(res, 'FORBIDDEN');
    }

    // A driver raises an issue for a stop on their own trip, not for someone else's.
    const raised = await call(world, 'driver', 'post', '/issues', {
      key: 'k-driver-issue',
      body: {
        stopId: seeded.stopId,
        type: 'DAMAGED',
        qtyAffected: 1,
        description: 'Pallet tipped at the dock',
      },
    });
    expect(raised.status).toBe(201);
    expect(issue(raised)).toMatchObject({
      raisedByRole: 'driver',
      outletId: world.kadawatha,
    });
    const stranger = await call(world, 'otherDriver', 'post', '/issues', {
      key: 'k-stranger',
      body: {
        stopId: seeded.stopId,
        type: 'DAMAGED',
        description: 'Not my stop',
      },
    });
    expect(stranger.status).toBe(404);
  });

  it('AC-RCP-12 the issue thread', async () => {
    const seeded = await seedDelivery(world);
    const id = await seedIssue(world, {
      orderId: seeded.orderId,
      stopId: seeded.stopId,
    });

    const posted = await call(
      world,
      'dispatcher',
      'post',
      `/issues/${id}/comments`,
      { body: { body: 'Credit on the way' } },
    );

    expect(posted.status).toBe(201);
    expect((posted.body as { data: CommentDto }).data.body).toBe(
      'Credit on the way',
    );
    const [stored, ...rest] = await commentRows(world, id);
    expect(rest).toHaveLength(0);
    expect(stored).toMatchObject({
      entityType: 'issue',
      authorId: world.as.dispatcher.id,
      authorRole: 'dispatcher',
    });
    const events = await outboxRows(world, 'issue.commented');
    expect(events).toHaveLength(1);
    // Ids only: never the body or the author's name.
    expect(JSON.stringify(events[0].payload)).not.toContain('Credit');
    expect(await auditRows(world, 'receipt.issue.commented')).toHaveLength(1);

    // The store reads the thread the dispatcher wrote.
    const thread = await call(world, 'store', 'get', `/issues/${id}/comments`);
    expect(thread.status).toBe(200);
    expect(data<CommentDto[]>(thread).map((c) => c.body)).toEqual([
      'Credit on the way',
    ]);

    const tooLong = await call(
      world,
      'store',
      'post',
      `/issues/${id}/comments`,
      {
        body: { body: 'x'.repeat(1001) },
      },
    );
    expect(tooLong.status).toBe(400);
    expectProblem(tooLong, 'VALIDATION_FAILED');
    expect(JSON.stringify(tooLong.body)).toContain('body');
    expect(await commentRows(world, id)).toHaveLength(1);

    const driver = await call(world, 'driver', 'get', `/issues/${id}/comments`);
    expect(driver.status).toBe(403);
    expectProblem(driver, 'FORBIDDEN');
  });

  it('AC-RCP-13 the dispatcher resolves an issue', async () => {
    const seeded = await seedDelivery(world);
    const id = await seedIssue(world, {
      orderId: seeded.orderId,
      stopId: seeded.stopId,
    });
    at(world, '2026-10-02T11:00:00+05:30');

    const byStore = await call(
      world,
      'store',
      'post',
      `/issues/${id}/resolve`,
      {
        body: { resolution: 'CREDIT_ISSUED' },
      },
    );
    expect(byStore.status).toBe(403);
    expectProblem(byStore, 'FORBIDDEN');

    const none = await call(
      world,
      'dispatcher',
      'post',
      `/issues/${id}/resolve`,
      {
        body: {},
      },
    );
    expect(none.status).toBe(400);
    expectProblem(none, 'VALIDATION_FAILED');
    expect(JSON.stringify(none.body)).toContain('resolution');

    const res = await call(
      world,
      'dispatcher',
      'post',
      `/issues/${id}/resolve`,
      {
        body: { resolution: 'CREDIT_ISSUED', note: 'Credit note sent' },
      },
    );

    expect(res.status).toBe(200);
    expect(issue(res)).toMatchObject({
      status: 'RESOLVED',
      resolution: 'CREDIT_ISSUED',
      resolutionNote: 'Credit note sent',
      resolvedById: world.as.dispatcher.id,
      resolvedAt: '2026-10-02T11:00:00+05:30',
    });
    const events = await outboxRows(world, 'issue.resolved');
    expect(events).toHaveLength(1);
    // The id alerts clears the STORE_ISSUE alert by.
    expect(events[0].payload).toMatchObject({ issueId: id });
    const [audit, ...more] = await auditRows(world, 'receipt.issue.resolved');
    expect(more).toHaveLength(0);
    expect(audit.reasonCode).toBe('CREDIT_ISSUED');

    // Nimesha's view carries a reopen link and no resolve link.
    const mine = await call(world, 'store', 'get', `/issues/${id}`);
    expect(issue(mine)._links.reopen).toBeDefined();
    expect(issue(mine)._links.resolve).toBeUndefined();
    expect(issue(res)._links.resolve).toBeUndefined();

    const again = await call(
      world,
      'dispatcher',
      'post',
      `/issues/${id}/resolve`,
      {
        body: { resolution: 'NO_ACTION' },
      },
    );
    expect(again.status).toBe(409);
  });

  it('AC-RCP-14 reopen within 48 hours', async () => {
    const seeded = await seedDelivery(world);
    const resolved = {
      orderId: seeded.orderId,
      stopId: seeded.stopId,
      status: 'RESOLVED' as const,
      resolution: 'CREDIT_ISSUED' as const,
      resolvedAt: '2026-10-02T11:00:00+05:30',
    };
    const inside = await seedIssue(world, resolved);
    const edge = await seedIssue(world, resolved);
    const late = await seedIssue(world, resolved);

    at(world, '2026-10-04T10:59:00+05:30');
    const open = await call(world, 'store', 'post', `/issues/${inside}/reopen`);
    expect(open.status).toBe(200);
    expect(issue(open).status).toBe('OPEN');
    expect(issue(open)._links.reopen).toBeUndefined();
    expect(await auditRows(world, 'receipt.issue.reopened')).toHaveLength(1);

    // Exactly 48 hours is still inside the window.
    at(world, '2026-10-04T11:00:00+05:30');
    expect(
      (await call(world, 'store', 'post', `/issues/${edge}/reopen`)).status,
    ).toBe(200);

    at(world, '2026-10-04T11:01:00+05:30');
    const tooLate = await call(
      world,
      'store',
      'post',
      `/issues/${late}/reopen`,
    );
    expect(tooLate.status).toBe(409);
    expectProblem(tooLate, 'CONFLICT_STATE');
    const [row] = await world.db
      .select({ status: issues.status })
      .from(issues)
      .where(eq(issues.id, late));
    expect(row.status).toBe('RESOLVED');
    const view = await call(world, 'store', 'get', `/issues/${late}`);
    expect(issue(view)._links.reopen).toBeUndefined();

    const dispatcher = await call(
      world,
      'dispatcher',
      'post',
      `/issues/${late}/reopen`,
    );
    expect(dispatcher.status).toBe(403);
    expectProblem(dispatcher, 'FORBIDDEN');
    expect(await issueRows(world, seeded.orderId)).toHaveLength(3);
  });
});
