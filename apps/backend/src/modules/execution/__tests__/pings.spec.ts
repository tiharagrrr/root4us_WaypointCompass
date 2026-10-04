import { keepInTrail, metresBetween, rejectReason } from '../domain/pings';
import { whereNow } from '../services/position-simulator.service';

const t = (hms: string) => new Date(`2026-10-02T${hms}+05:30`);
const depot = { lat: 6.9608, lng: 79.8847 };
const kadawatha = { lat: 7.001, lng: 79.953 };
const stop = (over: Partial<Parameters<typeof whereNow>[2][number]> = {}) => ({
  status: 'PENDING',
  plannedArrivalAt: t('04:40:00'),
  arrivedAt: null,
  completedAt: null,
  ...kadawatha,
  ...over,
});

describe('the ping rules', () => {
  it('refuses fixes outside Sri Lanka, inaccurate, from the future or too old', () => {
    const now = t('04:12:00');
    const ok = {
      lat: 7.0,
      lng: 79.95,
      accuracyM: 12,
      recordedAt: t('04:11:00'),
    };
    expect(rejectReason(ok, now)).toBeNull();
    expect(rejectReason({ ...ok, lat: 51.5, lng: -0.12 }, now)).toBe(
      'outside_sri_lanka',
    );
    expect(rejectReason({ ...ok, accuracyM: 250 }, now)).toBe('inaccurate');
    expect(rejectReason({ ...ok, recordedAt: t('04:15:00') }, now)).toBe(
      'from_the_future',
    );
    expect(
      rejectReason(
        { ...ok, recordedAt: new Date('2026-10-01T04:00:00+05:30') },
        now,
      ),
    ).toBe('too_old');
  });

  it('keeps a trail point every 30 seconds or 100 m, forward only', () => {
    const last = { lat: 7.0, lng: 79.95, recordedAt: t('04:10:00') };
    expect(keepInTrail(null, last)).toBe(true);
    expect(keepInTrail(last, { ...last, recordedAt: t('04:10:20') })).toBe(
      false,
    );
    expect(keepInTrail(last, { ...last, recordedAt: t('04:10:30') })).toBe(
      true,
    );
    expect(
      keepInTrail(last, { ...last, lat: 7.001, recordedAt: t('04:10:05') }),
    ).toBe(true);
    expect(
      keepInTrail(last, { ...last, lat: 7.01, recordedAt: t('04:09:00') }),
    ).toBe(false);
    expect(Math.round(metresBetween(depot, kadawatha))).toBeGreaterThan(8_000);
  });
});

describe('the demo position simulator', () => {
  it('drives from the depot towards the next stop by the planned arrival', () => {
    const half = whereNow(depot, t('04:00:00'), [stop()], t('04:20:00'))!;
    expect(half.lat).toBeCloseTo((depot.lat + kadawatha.lat) / 2, 4);
    expect(half.lng).toBeCloseTo((depot.lng + kadawatha.lng) / 2, 4);
    expect(half.moving).toBe(true);

    // Late: it waits just short of the outlet, because arriving is the driver's to record.
    const late = whereNow(depot, t('04:00:00'), [stop()], t('05:30:00'))!;
    expect(late.lat).toBeLessThan(kadawatha.lat);
    expect(late.lat).toBeGreaterThan(
      depot.lat + 0.95 * (kadawatha.lat - depot.lat),
    );
  });

  it('sits at an outlet while arrived, and leaves from the last finished stop', () => {
    expect(
      whereNow(
        depot,
        t('04:00:00'),
        [stop({ status: 'ARRIVED' })],
        t('04:45:00'),
      ),
    ).toMatchObject({
      ...kadawatha,
      moving: false,
    });
    const ja = { lat: 7.0744, lng: 79.8919 };
    const onward = whereNow(
      depot,
      t('04:00:00'),
      [
        stop({ status: 'DELIVERED', completedAt: t('04:50:00') }),
        stop({ ...ja, plannedArrivalAt: t('05:10:00') }),
      ],
      t('04:50:00'),
    )!;
    expect(onward).toMatchObject({ lat: kadawatha.lat, lng: kadawatha.lng });
  });
});
