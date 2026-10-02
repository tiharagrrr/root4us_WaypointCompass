import { PinoLogger } from 'nestjs-pino';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import {
  at,
  auditRows,
  buildWorld,
  call,
  deliveryLineRows,
  eventRows,
  orderLineRows,
  orderRow,
  outboxRows,
  resetTrips,
  seedTrip,
  setOrderStatus,
  stopRow,
  tearDownWorld,
  tripRow,
  type World,
} from './execution.world';

/** The log lines a recording wrote, by their `event` field. */
const logged = (
  spy: jest.SpyInstance,
  event: string,
): Record<string, unknown>[] =>
  spy.mock.calls
    .map(([first]) => first as Record<string, unknown>)
    .filter((line) => line && typeof line === 'object' && line.event === event);

describeWithDb('execution: field events from D1 to D8', () => {
  let world: World;
  let logs: jest.SpyInstance;

  beforeAll(async () => {
    world = await buildWorld();
  });

  afterAll(async () => {
    await tearDownWorld(world);
  });

  beforeEach(async () => {
    await resetTrips(world);
    logs = jest.spyOn(PinoLogger.prototype, 'info');
  });

  afterEach(() => {
    logs.mockRestore();
  });

  it('AC-EXE-06 start a released trip', async () => {
    const trip = await seedTrip(world, { tripNo: 1, stops: 3 });
    at(world, '2026-10-02T03:40:00+05:30');

    const res = await call(
      world,
      'aniqa',
      'post',
      `/trips/${trip.tripId}/start`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T03:40:00+05:30',
      reeferTempC: 3.4,
    });
    expect(res.status).toBe(200);

    const row = await tripRow(world, trip.tripId);
    expect(row.status).toBe('IN_PROGRESS');
    expect(row.startedAt).toEqual(new Date('2026-10-02T03:40:00+05:30'));
    expect(row.releaseTempC).toBe(3.4);

    for (const orderId of trip.orderIds)
      expect((await orderRow(world, orderId)).status).toBe('IN_TRANSIT');

    expect(await eventRows(world, trip.tripId, 'TRIP_STARTED')).toHaveLength(1);
    expect(
      await auditRows(world, 'execution.trip.started', trip.tripId),
    ).toHaveLength(1);
    const emitted = await outboxRows(world, 'trip.started', trip.tripId);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({
      v: 1,
      tripId: trip.tripId,
      stops: 3,
      reeferTempC: 3.4,
    });
  });

  it('AC-EXE-07 a trip starts only when released', async () => {
    const trip = await seedTrip(world, {
      tripNo: 2,
      status: 'LOADING',
      stops: 2,
    });
    at(world, '2026-10-02T03:40:00+05:30');

    const res = await call(
      world,
      'aniqa',
      'post',
      `/trips/${trip.tripId}/start`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T03:40:00+05:30',
      reeferTempC: 3.4,
    });
    expect(res.status).toBe(409);
    expectProblem(res, 'CONFLICT_STATE');

    expect((await tripRow(world, trip.tripId)).status).toBe('LOADING');
    expect(await eventRows(world, trip.tripId)).toHaveLength(0);
    expect(await auditRows(world, 'execution.trip.started')).toHaveLength(0);
    expect(await outboxRows(world, 'trip.started')).toHaveLength(0);
  });

  it('AC-EXE-08 arrive out of sequence', async () => {
    const trip = await seedTrip(world, {
      tripNo: 1,
      status: 'IN_PROGRESS',
      stops: 3,
    });
    at(world, '2026-10-02T04:12:05+05:30');

    const res = await call(
      world,
      'aniqa',
      'post',
      `/stops/${trip.stopIds[2]}/arrive`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T04:12:05+05:30',
      lat: 7.0014,
      lng: 79.9507,
    });
    expect(res.status).toBe(200);

    const third = await stopRow(world, trip.stopIds[2]);
    expect(third.status).toBe('ARRIVED');
    expect(third.arrivedAt).toEqual(new Date('2026-10-02T04:12:05+05:30'));
    expect(third.arrivedLat).toBe(7.0014);
    expect((await stopRow(world, trip.stopIds[1])).status).toBe('PENDING');

    // The out-of-sequence visit is logged, with ids only.
    const line = logged(logs, 'execution.stop.out_of_sequence')[0];
    expect(line).toMatchObject({
      tripId: trip.tripId,
      stopId: trip.stopIds[2],
      seq: 3,
    });

    expect(
      await auditRows(world, 'execution.stop.arrived', trip.stopIds[2]),
    ).toHaveLength(1);
    expect(
      await outboxRows(world, 'stop.arrived', trip.stopIds[2]),
    ).toHaveLength(1);
  });

  it('AC-EXE-09 deliver in full', async () => {
    const trip = await seedTrip(world, {
      tripNo: 1,
      status: 'IN_PROGRESS',
      stopStatus: 'ARRIVED',
      stops: 1,
      lines: 3,
      qty: 10,
    });
    await markInTransit(world, trip.orderIds[0]);
    const lines = await orderLineRows(world, trip.orderIds[0]);
    expect(lines).toHaveLength(3);
    at(world, '2026-10-02T04:20:00+05:30');

    const res = await call(
      world,
      'aniqa',
      'post',
      `/stops/${trip.stopIds[0]}/complete`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T04:20:00+05:30',
      outcome: 'DELIVERED',
      receiverName: 'K. Fernando',
      lines: lines.map((line) => ({
        orderLineId: line.id,
        qtyDelivered: line.qty,
        condition: 'ok',
      })),
      attachmentUuids: [crypto.randomUUID()],
    });
    expect(res.status).toBe(200);

    const stop = await stopRow(world, trip.stopIds[0]);
    expect(stop.status).toBe('DELIVERED');
    expect(stop.completedAt).toEqual(new Date('2026-10-02T04:20:00+05:30'));
    expect(stop.receiverName).toBe('K. Fernando');

    const delivered = await deliveryLineRows(world, trip.stopIds[0]);
    expect(delivered).toHaveLength(3);
    expect(delivered.every((line) => line.condition === 'ok')).toBe(true);
    expect(delivered.every((line) => line.qtyDelivered === 10)).toBe(true);
    expect(delivered.every((line) => line.qtyExpected === 10)).toBe(true);

    expect((await orderRow(world, trip.orderIds[0])).status).toBe('DELIVERED');

    expect(
      await auditRows(world, 'execution.stop.completed', trip.stopIds[0]),
    ).toHaveLength(1);
    const emitted = await outboxRows(world, 'stop.completed', trip.stopIds[0]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({
      tripId: trip.tripId,
      outcome: 'DELIVERED',
      unitsDelivered: 30,
    });

    // One log line, with the type and lateSync — and no receiver's name in it.
    const line = logged(logs, 'execution.stop.recorded').filter(
      (l) => l.type === 'DELIVERED',
    );
    expect(line).toHaveLength(1);
    expect(line[0]).toMatchObject({ type: 'DELIVERED', lateSync: false });
    expect(JSON.stringify(line[0])).not.toContain('Fernando');
  });

  it('AC-EXE-10 proof and notes are required', async () => {
    const trip = await seedTrip(world, {
      tripNo: 1,
      status: 'IN_PROGRESS',
      stopStatus: 'ARRIVED',
      stops: 3,
    });
    at(world, '2026-10-02T04:20:00+05:30');
    const base = { occurredAt: '2026-10-02T04:20:00+05:30' };

    const noReceiver = await call(
      world,
      'aniqa',
      'post',
      `/stops/${trip.stopIds[0]}/complete`,
    ).send({
      ...base,
      clientUuid: crypto.randomUUID(),
      outcome: 'DELIVERED',
      attachmentUuids: [crypto.randomUUID()],
    });
    expect(noReceiver.status).toBe(400);
    expect(expectProblem(noReceiver, 'VALIDATION_FAILED').errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'receiverName' }),
      ]),
    );

    const noProof = await call(
      world,
      'aniqa',
      'post',
      `/stops/${trip.stopIds[1]}/complete`,
    ).send({
      ...base,
      clientUuid: crypto.randomUUID(),
      outcome: 'PARTIAL',
      receiverName: 'K. Fernando',
      note: '2 trays short',
      attachmentUuids: [],
    });
    expect(noProof.status).toBe(400);
    expect(expectProblem(noProof, 'VALIDATION_FAILED').errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'attachmentUuids' }),
      ]),
    );

    const noNote = await call(
      world,
      'aniqa',
      'post',
      `/stops/${trip.stopIds[2]}/fail`,
    ).send({
      ...base,
      clientUuid: crypto.randomUUID(),
      outcome: 'OUTLET_CLOSED',
    });
    expect(noNote.status).toBe(400);
    expect(expectProblem(noNote, 'VALIDATION_FAILED').errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'note' })]),
    );

    for (const stopId of trip.stopIds)
      expect((await stopRow(world, stopId)).status).toBe('ARRIVED');
    expect(await eventRows(world, trip.tripId)).toHaveLength(0);
  });

  it('AC-EXE-11 partial delivery', async () => {
    const trip = await seedTrip(world, {
      tripNo: 1,
      status: 'IN_PROGRESS',
      stopStatus: 'ARRIVED',
      stops: 1,
      qty: 10,
    });
    await markInTransit(world, trip.orderIds[0]);
    const [line] = await orderLineRows(world, trip.orderIds[0]);
    at(world, '2026-10-02T04:35:00+05:30');

    const res = await call(
      world,
      'aniqa',
      'post',
      `/stops/${trip.stopIds[0]}/complete`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T04:35:00+05:30',
      outcome: 'PARTIAL',
      receiverName: 'K. Fernando',
      note: '2 trays crushed',
      lines: [
        {
          orderLineId: line.id,
          qtyDelivered: 8,
          condition: 'damaged',
          note: '2 trays crushed',
        },
      ],
      attachmentUuids: [crypto.randomUUID()],
    });
    expect(res.status).toBe(200);

    expect((await stopRow(world, trip.stopIds[0])).status).toBe('PARTIAL');
    expect((await orderRow(world, trip.orderIds[0])).status).toBe('PARTIAL');

    const [delivered] = await deliveryLineRows(world, trip.stopIds[0]);
    expect(delivered).toMatchObject({
      qtyDelivered: 8,
      qtyExpected: 10,
      condition: 'damaged',
    });

    const audit = await auditRows(
      world,
      'execution.stop.partial',
      trip.stopIds[0],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toMatchObject({
      outcome: 'PARTIAL',
      note: '2 trays crushed',
    });

    // One event for the outcome: stop.completed carrying outcome PARTIAL.
    const emitted = await outboxRows(world, 'stop.completed', trip.stopIds[0]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ outcome: 'PARTIAL' });
    expect(await outboxRows(world, 'stop.partial')).toHaveLength(0);
  });

  it('AC-EXE-12 failed delivery', async () => {
    const trip = await seedTrip(world, {
      tripNo: 1,
      status: 'IN_PROGRESS',
      stopStatus: 'ARRIVED',
      stops: 1,
    });
    await markInTransit(world, trip.orderIds[0]);
    at(world, '2026-10-02T05:10:00+05:30');

    const res = await call(
      world,
      'aniqa',
      'post',
      `/stops/${trip.stopIds[0]}/fail`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T05:10:00+05:30',
      outcome: 'OUTLET_CLOSED',
      note: 'Shutter down',
    });
    expect(res.status).toBe(200);

    const stop = await stopRow(world, trip.stopIds[0]);
    expect(stop.status).toBe('FAILED');
    expect(stop.outcome).toBe('OUTLET_CLOSED');
    expect(stop.exceptionNote).toBe('Shutter down');
    expect((await orderRow(world, trip.orderIds[0])).status).toBe('FAILED');

    const audit = await auditRows(
      world,
      'execution.stop.failed',
      trip.stopIds[0],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toMatchObject({
      outcome: 'OUTLET_CLOSED',
      note: 'Shutter down',
    });
    expect(
      await outboxRows(world, 'stop.failed', trip.stopIds[0]),
    ).toHaveLength(1);
  });

  it('AC-EXE-13 a recorded outcome is never changed', async () => {
    const trip = await seedTrip(world, {
      tripNo: 1,
      status: 'IN_PROGRESS',
      stopStatus: 'ARRIVED',
      stops: 1,
    });
    await markInTransit(world, trip.orderIds[0]);
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
      attachmentUuids: [crypto.randomUUID()],
    });
    expect(delivered.status).toBe(200);
    const before = (await eventRows(world, trip.tripId, 'DELIVERED'))[0];

    at(world, '2026-10-02T04:25:00+05:30');
    const res = await call(
      world,
      'aniqa',
      'post',
      `/stops/${trip.stopIds[0]}/fail`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T04:25:00+05:30',
      outcome: 'REFUSED',
      note: 'Changed their mind',
    });
    expect(res.status).toBe(409);
    expectProblem(res, 'CONFLICT_STATE');

    expect((await stopRow(world, trip.stopIds[0])).status).toBe('DELIVERED');
    const after = (await eventRows(world, trip.tripId, 'DELIVERED'))[0];
    expect(after).toEqual(before);
    expect(await eventRows(world, trip.tripId, 'FAILED')).toHaveLength(0);
    expect(await outboxRows(world, 'stop.failed')).toHaveLength(0);
    expect(await auditRows(world, 'execution.stop.failed')).toHaveLength(0);
  });

  it("AC-EXE-14 can't run this trip", async () => {
    const trip = await seedTrip(world, { tripNo: 2, stops: 2 });
    at(world, '2026-10-02T04:40:00+05:30');

    const res = await call(
      world,
      'aniqa',
      'post',
      `/trips/${trip.tripId}/cant-run`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T04:40:00+05:30',
      reasonCode: 'BREAKDOWN',
      note: 'Compressor stopped at Peliyagoda',
      attachmentUuids: [crypto.randomUUID()],
    });
    expect(res.status).toBe(200);

    expect(await eventRows(world, trip.tripId, 'CANT_RUN')).toHaveLength(1);
    const audit = await auditRows(
      world,
      'execution.trip.cant_run',
      trip.tripId,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].reasonCode).toBe('BREAKDOWN');
    // The DRIVER_CANT_RUN alert and its repair suggestion are the alerts and
    // planning modules' own criteria, raised off this event.
    const emitted = await outboxRows(world, 'trip.cant_run', trip.tripId);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ reason: 'BREAKDOWN' });

    // The trip keeps its vehicle and driver until a dispatcher reassigns it.
    const row = await tripRow(world, trip.tripId);
    expect(row.vehicleId).toBe(trip.vehicleId);
    expect(row.driverId).toBe(world.as.aniqa.id);
    expect(row.cantRunReason).toBe('BREAKDOWN');
    expect(row.status).toBe('RELEASED');

    const noReason = await call(
      world,
      'aniqa',
      'post',
      `/trips/${trip.tripId}/cant-run`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T04:41:00+05:30',
      note: 'Compressor stopped',
    });
    expect(noReason.status).toBe(400);
    expect(expectProblem(noReason, 'VALIDATION_FAILED').errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'reasonCode' }),
      ]),
    );
  });

  it('AC-EXE-15 complete the trip', async () => {
    const trip = await seedTrip(world, {
      tripNo: 1,
      status: 'IN_PROGRESS',
      stopStatus: 'DELIVERED',
      stops: 3,
    });
    at(world, '2026-10-02T06:05:00+05:30');

    const res = await call(
      world,
      'aniqa',
      'post',
      `/trips/${trip.tripId}/complete`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T06:05:00+05:30',
    });
    expect(res.status).toBe(200);

    const row = await tripRow(world, trip.tripId);
    expect(row.status).toBe('COMPLETED');
    expect(row.completedAt).toEqual(new Date('2026-10-02T06:05:00+05:30'));

    expect(await eventRows(world, trip.tripId, 'TRIP_COMPLETED')).toHaveLength(
      1,
    );
    expect(
      await auditRows(world, 'execution.trip.completed', trip.tripId),
    ).toHaveLength(1);
    expect(await outboxRows(world, 'trip.completed', trip.tripId)).toHaveLength(
      1,
    );
    // Position pings after a completed trip are the tracking issue's criterion.
  });

  it('AC-EXE-15 a trip with an unfinished stop cannot be completed', async () => {
    const trip = await seedTrip(world, {
      tripNo: 1,
      status: 'IN_PROGRESS',
      stopStatus: 'PENDING',
      stops: 2,
    });
    at(world, '2026-10-02T06:05:00+05:30');

    const res = await call(
      world,
      'aniqa',
      'post',
      `/trips/${trip.tripId}/complete`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T06:05:00+05:30',
    });
    expect(res.status).toBe(409);
    expect(expectProblem(res, 'CONFLICT_STATE').detail).toContain(
      '2 stops have no result yet',
    );
    expect((await tripRow(world, trip.tripId)).status).toBe('IN_PROGRESS');
    expect(await eventRows(world, trip.tripId)).toHaveLength(0);
  });
});

/** The order left the depot with its trip, which is where a delivery starts. */
const markInTransit = (world: World, orderId: string) =>
  setOrderStatus(world, orderId, 'IN_TRANSIT');
