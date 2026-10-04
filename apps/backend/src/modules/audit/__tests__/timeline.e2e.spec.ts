import { TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import { receipt } from '../../../../test/worlds';
import { ClockService } from '../../../core/clock/clock.service';
import { loadCheckLines } from '../../../db/schema';
import type { TimelineEntryDto } from '../dto/timeline.dto';
import { type AuditInput, AuditService } from '../services/audit.service';

const {
  at,
  buildWorld,
  call,
  data,
  resetDeliveries,
  seedDelivery,
  tearDownWorld,
} = receipt;

/**
 * The order timeline (specs/audit/spec.md, AC-AUD-03, 20 and 21), in the receipt suites'
 * world: Nimesha at Fresh Kadawatha, a store manager at another outlet, Aniqa the driver.
 * The ordering, loading and execution rows are recorded through AuditService with the
 * clocks the criterion names; the receipt row is the one a real confirmation writes.
 */
describeWithDb('audit: order timeline', () => {
  jest.setTimeout(60_000);

  let world: receipt.World;
  let loadLineId: string | undefined;

  beforeAll(async () => {
    world = await buildWorld();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await tearDownWorld(world);
  });

  beforeEach(async () => {
    // The load line this suite adds hangs off the trip, so it goes before the world's reset.
    if (loadLineId)
      await world.db
        .delete(loadCheckLines)
        .where(eq(loadCheckLines.id, loadLineId));
    loadLineId = undefined;
    await resetDeliveries(world);
  });

  /** One audit row whose occurredAt and recordedAt are the given instants. */
  async function record(
    input: AuditInput & { occurredAt: Date },
    recordedAt: string,
  ) {
    const clock = world.app.get(ClockService);
    const real = jest
      .spyOn(clock, 'realNow')
      .mockReturnValue(new Date(recordedAt));
    try {
      await world.app
        .get<TransactionHost>(TransactionHost)
        .withTransaction(() => world.app.get(AuditService).record(input));
    } finally {
      real.mockRestore();
    }
  }

  it('AC-AUD-03 order timeline merges four modules', async () => {
    const seeded = await seedDelivery(world);
    const [loadLine] = await world.db
      .insert(loadCheckLines)
      .values({
        tripId: seeded.tripId,
        orderId: seeded.orderId,
        orderLineId: seeded.lineIds[0],
        stopSeq: 1,
        qtyExpected: 12,
        planRevision: 1,
      })
      .returning({ id: loadCheckLines.id });
    loadLineId = loadLine.id;

    // Recorded out of order, so the response's order is the timeline's doing.
    await record(
      {
        action: 'execution.stop.delivered',
        entity: ['stop', seeded.stopId],
        occurredAt: new Date('2026-10-02T04:22:00+05:30'),
        source: 'OFFLINE_SYNC',
        actorName: 'Aniqa Razick',
        reasonCode: 'DELIVERED',
      },
      '2026-10-02T04:31:00+05:30',
    );
    await record(
      {
        action: 'loading.load_line.checked',
        entity: ['load_line', loadLine.id],
        occurredAt: new Date('2026-10-02T02:40:00+05:30'),
        source: 'PWA',
        actorName: 'Harini De Mel',
      },
      '2026-10-02T02:45:00+05:30',
    );
    await record(
      {
        action: 'ordering.order.submitted',
        entity: ['order', seeded.orderId],
        occurredAt: new Date('2026-10-01T14:02:11+05:30'),
        actorName: 'Nimesha Periyapperuma',
      },
      '2026-10-01T14:02:11+05:30',
    );
    at(world, '2026-10-02T09:10:00+05:30');
    const confirmed = await call(
      world,
      'store',
      'post',
      `/orders/${seeded.orderId}/receipt`,
      {
        ifMatch: 8,
        key: 'timeline-confirm',
        body: {
          lines: seeded.lineIds.map((orderLineId) => ({
            orderLineId,
            qtyReceived: 12,
            condition: 'ok',
          })),
        },
      },
    );
    expect(confirmed.status).toBe(201);

    const res = await call(
      world,
      'store',
      'get',
      `/timelines/order/${seeded.orderId}`,
    );

    expect(res.status).toBe(200);
    const entries = data<TimelineEntryDto[]>(res);
    expect(entries.map((entry) => entry.action)).toEqual([
      'ordering.order.submitted',
      'loading.load_line.checked',
      'execution.stop.delivered',
      // Confirming moves the order to RECEIVED, which ordering records itself.
      'ordering.order.status_changed',
      'receipt.confirmed',
    ]);
    for (const entry of entries) {
      expect(typeof entry.actorName).toBe('string');
      expect(typeof entry.source).toBe('string');
      expect(typeof entry.occurredAt).toBe('string');
      expect(typeof entry.recordedAt).toBe('string');
      for (const field of ['actorRole', 'deviceId', 'reasonCode', 'reasonNote'])
        expect(entry).toHaveProperty(field);
    }
    const [, loaded, delivered, moved, received] = entries;
    expect(delivered).toMatchObject({
      syncedLate: true,
      source: 'OFFLINE_SYNC',
      reasonCode: 'DELIVERED',
    });
    expect(loaded.syncedLate).toBe(false);
    expect(moved.status).toBe('RECEIVED');
    expect(received).toMatchObject({
      actorName: 'Nimesha Periyapperuma',
      actorRole: 'store_manager',
      syncedLate: false,
    });
  });

  it('AC-AUD-20 out-of-scope timeline is not found', async () => {
    const seeded = await seedDelivery(world);

    const res = await call(
      world,
      'otherStore',
      'get',
      `/timelines/order/${seeded.orderId}`,
    );

    expect(res.status).toBe(404);
    expectProblem(res, 'NOT_FOUND');
  });

  it("AC-AUD-21 drivers can't read order timelines", async () => {
    const seeded = await seedDelivery(world);

    const res = await call(
      world,
      'driver',
      'get',
      `/timelines/order/${seeded.orderId}`,
    );

    expect(res.status).toBe(403);
    expectProblem(res, 'FORBIDDEN');
  });
});
