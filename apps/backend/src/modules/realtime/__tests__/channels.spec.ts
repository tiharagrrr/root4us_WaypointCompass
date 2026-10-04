import type { Actor } from '@waypoint/shared';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import {
  ALL_DEPOTS,
  BROADCAST,
  channelsFor,
  reaches,
  toDomainEvent,
} from '../domain/channels';

const actor = (over: Partial<Actor>): Actor => ({
  id: 'u1',
  name: 'Test',
  role: 'dispatcher',
  depotId: null,
  outletId: null,
  vehicleId: null,
  deviceId: null,
  ...over,
});

const event = (over: Partial<DeliveredEvent>): DeliveredEvent => ({
  id: '0190a000-0000-7000-8000-000000000001',
  type: 'order.submitted',
  aggregateType: 'order',
  aggregateId: 'o1',
  depotId: 'PLG',
  outletIds: [],
  userIds: [],
  payload: { v: 1 },
  occurredAt: new Date('2026-10-04T01:00:00Z'),
  correlationId: null,
  ...over,
});

describe('realtime channels', () => {
  it("AC-RT-01 A dispatcher's stream covers her depots", () => {
    const all = channelsFor(actor({ id: 'tihara' }));
    expect([...all]).toEqual([ALL_DEPOTS, 'user:tihara', BROADCAST]);
    expect(reaches(all, event({ depotId: 'KDY' }))).toBe(true);

    const plg = channelsFor(actor({ depotId: 'PLG' }));
    expect(reaches(plg, event({ depotId: 'PLG' }))).toBe(true);
    expect(reaches(plg, event({ depotId: 'KDY' }))).toBe(false);
  });

  it('AC-RT-02 A store manager sees only her outlet', () => {
    const nimesha = channelsFor(
      actor({ role: 'store_manager', outletId: 'OUT01' }),
    );
    expect(reaches(nimesha, event({ outletIds: ['OUT01'] }))).toBe(true);
    expect(reaches(nimesha, event({ outletIds: ['OUT02'] }))).toBe(false);
  });

  it('AC-RT-03 Loaders and drivers get their own channels', () => {
    const harini = channelsFor(
      actor({ id: 'harini', role: 'loader', depotId: 'PLG' }),
    );
    expect([...harini]).toEqual([
      'depot:PLG:loading',
      'user:harini',
      BROADCAST,
    ]);
    expect(reaches(harini, event({ type: 'load.flag_raised' }))).toBe(true);
    expect(reaches(harini, event({ type: 'order.submitted' }))).toBe(false);

    const aniqa = channelsFor(actor({ id: 'aniqa', role: 'driver' }), [
      'ref07',
    ]);
    expect([...aniqa]).toEqual(['trip:ref07', 'user:aniqa', BROADCAST]);
    const released = (tripId: string) =>
      event({
        type: 'trip.released',
        aggregateType: 'trip',
        aggregateId: tripId,
      });
    expect(reaches(aniqa, released('ref07'))).toBe(true);
    expect(reaches(aniqa, released('dry31'))).toBe(false);
    expect(
      reaches(
        aniqa,
        event({ type: 'stop.completed', payload: { tripId: 'ref07' } }),
      ),
    ).toBe(true);
  });

  it('AC-RT-04 Frames carry the outbox id and the envelope', () => {
    const e = event({
      type: 'plan.published',
      aggregateType: 'plan',
      aggregateId: 'p1',
      payload: { v: 1, planId: 'p1' },
    });
    expect(toDomainEvent(e)).toEqual({
      v: 1,
      type: 'plan.published',
      aggregate: { type: 'plan', id: 'p1' },
      routing: { depotId: 'PLG', outletIds: [], userIds: [] },
      data: { v: 1, planId: 'p1' },
      occurredAt: '2026-10-04T01:00:00.000Z',
    });
  });

  it('AC-RT-08 Stores never see the map', () => {
    const nimesha = channelsFor(
      actor({ role: 'store_manager', outletId: 'OUT01' }),
    );
    expect(
      reaches(nimesha, event({ type: 'eta.updated', outletIds: ['OUT01'] })),
    ).toBe(true);
    expect(
      reaches(
        nimesha,
        event({ type: 'vehicle.position', outletIds: ['OUT01'] }),
      ),
    ).toBe(false);
  });

  it('AC-RT-11 Clock changes reach everyone', () => {
    const clock = event({ type: 'clock.changed', depotId: null });
    for (const role of [
      'admin',
      'dispatcher',
      'store_manager',
      'loader',
      'driver',
    ] as const)
      expect(reaches(channelsFor(actor({ role, depotId: 'PLG' })), clock)).toBe(
        true,
      );
  });

  it('AC-RT-14 A cutoff change reaches every role', () => {
    const changes = [
      event({ type: 'settings.changed', depotId: null }),
      event({ type: 'depot.updated', depotId: 'PLG' }),
    ];
    for (const change of changes)
      for (const role of [
        'admin',
        'dispatcher',
        'store_manager',
        'loader',
        'driver',
      ] as const)
        expect(
          reaches(channelsFor(actor({ role, depotId: 'PLG' })), change),
        ).toBe(true);
  });

  it('AC-RT-13 A role change reaches the user at once', () => {
    const changed = event({
      type: 'identity.user.role_changed',
      aggregateType: 'user',
      aggregateId: 'harini',
      depotId: null,
    });
    const harini = channelsFor(
      actor({ id: 'harini', role: 'loader', depotId: 'PLG' }),
    );
    expect(reaches(harini, changed)).toBe(true);
    // A1 follows it too, though the event names no depot.
    expect(reaches(channelsFor(actor({ role: 'admin' })), changed)).toBe(true);
    expect(reaches(channelsFor(actor({ role: 'dispatcher' })), changed)).toBe(
      false,
    );
    expect(
      reaches(
        channelsFor(actor({ id: 'other', role: 'loader', depotId: 'PLG' })),
        changed,
      ),
    ).toBe(false);
  });
});
