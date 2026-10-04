import { eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import { execution, loading } from '../../../../test/worlds';
import { syncBatches } from '../../../db/schema';

const uuid = (sfx: string, n: number) =>
  `00000000-0000-4000-8000-${sfx.padStart(6, '0')}${String(n).padStart(6, '0')}`;

const PHONE = 'aniqa-phone-1';

type Result = { clientUuid: string; status: string; code?: string };
type Outcome = {
  batchId: string;
  results: Result[];
  received: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
};

describeWithDb('sync: a driver replays her outbox (ROO-44)', () => {
  let w: execution.World;

  beforeAll(async () => {
    w = await execution.buildWorld();
  });
  afterAll(() => execution.tearDownWorld(w));
  beforeEach(() => execution.resetTrips(w));

  const post = (role: execution.Role, body: unknown) =>
    execution.call(w, role, 'post', '/sync').send(body as object);

  /** Start, then arrive and deliver at every stop: deviceSeq 10 upwards, in the order tapped. */
  async function wholeRun(trip: execution.SeededTrip) {
    const events: Record<string, unknown>[] = [
      {
        clientUuid: uuid(w.sfx, 10),
        tripId: trip.tripId,
        type: 'TRIP_STARTED',
        occurredAt: '2026-10-02T04:10:00+05:30',
        deviceSeq: 10,
        reeferTempC: 3.4,
      },
    ];
    let seq = 11;
    for (const [i, stopId] of trip.stopIds.entries()) {
      const lines = await execution.orderLineRows(w, trip.orderIds[i]);
      events.push({
        clientUuid: uuid(w.sfx, seq),
        tripId: trip.tripId,
        stopId,
        type: 'ARRIVED',
        occurredAt: `2026-10-02T04:${12 + i * 10}:05+05:30`,
        deviceSeq: seq++,
      });
      events.push({
        clientUuid: uuid(w.sfx, seq),
        tripId: trip.tripId,
        stopId,
        type: 'DELIVERED',
        occurredAt: `2026-10-02T04:${18 + i * 10}:00+05:30`,
        deviceSeq: seq++,
        receiverName: 'K. Fernando',
        attachmentUuids: [crypto.randomUUID()],
        lines: lines.map((line) => ({
          orderLineId: line.id,
          qtyDelivered: line.qty,
          condition: 'ok',
        })),
      });
    }
    return events;
  }

  it('AC-SYN-01 a batch applies in deviceSeq order', async () => {
    const trip = await execution.seedTrip(w, { tripNo: 1, stops: 3 });
    execution.at(w, '2026-10-02T04:52:00+05:30');
    const events = await wholeRun(trip);
    // Shuffled on the wire: the device order is what counts.
    const shuffled = [
      events[3],
      events[1],
      events[2],
      events[6],
      events[0],
      events[4],
      events[5],
    ];

    const res = await post('aniqa', { deviceId: PHONE, events: shuffled });
    expect(res.status).toBe(200);
    const body = execution.data<Outcome>(res);
    expect(body.results.map((r) => r.status)).toEqual(Array(7).fill('applied'));
    expect(body).toMatchObject({
      received: 7,
      applied: 7,
      duplicates: 0,
      conflicts: 0,
      rejected: 0,
    });

    // Applied in device order: the trip started first, then each stop in turn.
    const recorded = await execution.eventRows(w, trip.tripId);
    expect(recorded.map((row) => row.deviceSeq)).toEqual([
      10, 11, 12, 13, 14, 15, 16,
    ]);
    expect(recorded.every((row) => row.deviceId === PHONE)).toBe(true);
    for (const stopId of trip.stopIds)
      expect((await execution.stopRow(w, stopId)).status).toBe('DELIVERED');
    for (const orderId of trip.orderIds)
      expect((await execution.orderRow(w, orderId)).status).toBe('DELIVERED');

    const [batch] = await w.db
      .select()
      .from(syncBatches)
      .where(eq(syncBatches.id, body.batchId));
    expect(batch).toMatchObject({
      deviceId: PHONE,
      received: 7,
      applied: 7,
      duplicates: 0,
    });
    const emitted = await execution.outboxRows(
      w,
      'sync.batch_applied',
      body.batchId,
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ v: 1, received: 7, applied: 7 });
  });

  it('AC-SYN-02 a replayed batch changes nothing', async () => {
    const trip = await execution.seedTrip(w, { tripNo: 1, stops: 2 });
    execution.at(w, '2026-10-02T04:52:00+05:30');
    const events = await wholeRun(trip);
    expect((await post('aniqa', { deviceId: PHONE, events })).status).toBe(200);
    const before = await execution.eventRows(w, trip.tripId);

    const again = await post('aniqa', { deviceId: PHONE, events });
    expect(again.status).toBe(200);
    const body = execution.data<Outcome>(again);
    expect(body.results.map((r) => r.status)).toEqual(
      Array(5).fill('duplicate'),
    );
    expect(body).toMatchObject({ received: 5, applied: 0, duplicates: 5 });
    expect(await execution.eventRows(w, trip.tripId)).toHaveLength(
      before.length,
    );
    // The trip is where the first batch left it: delivered stops, not yet completed (that is D7).
    expect((await execution.tripRow(w, trip.tripId)).status).toBe(
      'IN_PROGRESS',
    );
    for (const stopId of trip.stopIds)
      expect((await execution.stopRow(w, stopId)).status).toBe('DELIVERED');
  });

  it('AC-SYN-03 one bad event never blocks the rest', async () => {
    const trip = await execution.seedTrip(w, {
      tripNo: 1,
      stops: 2,
      status: 'IN_PROGRESS',
    });
    execution.at(w, '2026-10-02T05:00:00+05:30');
    const [d, e] = trip.stopIds;
    const base = {
      tripId: trip.tripId,
      occurredAt: '2026-10-02T04:40:00+05:30',
    };

    const res = await post('aniqa', {
      deviceId: PHONE,
      events: [
        {
          ...base,
          clientUuid: uuid(w.sfx, 21),
          stopId: d,
          type: 'ARRIVED',
          deviceSeq: 21,
        },
        // No receiver name: the proof rule refuses it.
        {
          ...base,
          clientUuid: uuid(w.sfx, 22),
          stopId: d,
          type: 'DELIVERED',
          deviceSeq: 22,
          attachmentUuids: [crypto.randomUUID()],
        },
        {
          ...base,
          clientUuid: uuid(w.sfx, 23),
          stopId: e,
          type: 'ARRIVED',
          deviceSeq: 23,
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = execution.data<Outcome>(res);
    expect(body.results.map((r) => [r.status, r.code])).toEqual([
      ['applied', undefined],
      ['rejected', 'VALIDATION_FAILED'],
      ['applied', undefined],
    ]);
    expect(body).toMatchObject({ applied: 2, rejected: 1 });
    expect(await execution.eventRows(w, trip.tripId, 'DELIVERED')).toHaveLength(
      0,
    );
    expect((await execution.stopRow(w, d)).status).toBe('ARRIVED');
    expect((await execution.stopRow(w, e)).status).toBe('ARRIVED');
  });

  it('AC-SYN-05 batches over 100 are refused, and a malformed envelope is a 400', async () => {
    const trip = await execution.seedTrip(w, { tripNo: 1, stops: 1 });
    const events = Array.from({ length: 101 }, (_, i) => ({
      clientUuid: uuid(w.sfx, 1000 + i),
      tripId: trip.tripId,
      type: 'TRIP_DOWNLOADED',
      occurredAt: '2026-10-02T03:00:00+05:30',
      deviceSeq: i,
    }));
    const tooMany = await post('aniqa', { deviceId: PHONE, events });
    expectProblem(tooMany, 'PAYLOAD_TOO_LARGE');
    expect(await execution.eventRows(w, trip.tripId)).toHaveLength(0);

    expectProblem(
      await post('aniqa', { events: 'not a list' }),
      'VALIDATION_FAILED',
    );
  });

  it('AC-SYN-13 a dispatcher may not sync an outbox', async () => {
    expectProblem(
      await post('dispatcher', { deviceId: 'desk', events: [] }),
      'FORBIDDEN',
    );
  });

  it('a driver cannot send a loader event; the rest of her batch still applies', async () => {
    const trip = await execution.seedTrip(w, { tripNo: 1, stops: 1 });
    execution.at(w, '2026-10-02T04:52:00+05:30');
    const res = await post('aniqa', {
      deviceId: PHONE,
      events: [
        {
          clientUuid: uuid(w.sfx, 30),
          tripId: trip.tripId,
          type: 'LOAD_LINE_CHECKED',
          occurredAt: '2026-10-02T02:45:00+05:30',
          deviceSeq: 30,
          loadLineId: crypto.randomUUID(),
          qtyLoaded: 1,
          checkedByName: 'Not a loader',
        },
        {
          clientUuid: uuid(w.sfx, 31),
          tripId: trip.tripId,
          type: 'TRIP_STARTED',
          occurredAt: '2026-10-02T04:10:00+05:30',
          deviceSeq: 31,
          reeferTempC: 3.1,
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = execution.data<Outcome>(res);
    expect(body.results.map((r) => [r.status, r.code])).toEqual([
      ['rejected', 'FORBIDDEN'],
      ['applied', undefined],
    ]);
    expect((await execution.tripRow(w, trip.tripId)).status).toBe(
      'IN_PROGRESS',
    );
  });
});

describeWithDb('sync: a dock tablet replays its outbox (ROO-44)', () => {
  let w: loading.World;

  beforeAll(async () => {
    w = await loading.buildWorld();
  });
  afterAll(() => loading.closeWorld(w));
  beforeEach(async () => {
    await loading.reset(w);
    loading.at(w, '2026-10-02T02:40:00+05:30');
  });

  it('AC-SYN-13 loader events ride the same endpoint, once', async () => {
    const trip = await loading.seedTrip(w, { stops: 1, lines: 3, qty: 12 });
    await loading.publish(w, trip);
    const lines = await loading.lineRows(w, trip.tripId);
    expect(lines).toHaveLength(3);

    const events = lines.map((line, i) => ({
      clientUuid: loading.tapUuid(w, 40 + i),
      tripId: trip.tripId,
      type: 'LOAD_LINE_CHECKED',
      occurredAt: '2026-10-02T02:45:10+05:30',
      deviceSeq: 40 + i,
      loadLineId: line.id,
      qtyLoaded: 12,
      checkedByName: 'Harini De Mel',
    }));

    const res = await loading.call(w, 'harini', 'post', '/sync', {
      deviceId: loading.DOCK_TABLET,
      events,
    });
    expect(res.status).toBe(200);
    const body = loading.data<Outcome>(res);
    expect(body.results.map((r) => r.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    for (const line of lines)
      expect(await loading.lineRow(w, line.id)).toMatchObject({
        status: 'OK',
        qtyLoaded: 12,
        checkedByName: 'Harini De Mel',
        deviceId: loading.DOCK_TABLET,
      });

    const again = await loading.call(w, 'harini', 'post', '/sync', {
      deviceId: loading.DOCK_TABLET,
      events,
    });
    expect(loading.data<Outcome>(again).results.map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
    ]);
    expect(await loading.lineRows(w, trip.tripId)).toHaveLength(3);
  });
});
