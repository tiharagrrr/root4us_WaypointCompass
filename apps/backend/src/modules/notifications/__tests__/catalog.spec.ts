import { CATALOG, consumes } from '../domain/catalog';
import { channelsFor, dedupeKeyOf, realEmail } from '../domain/channels';
import { dayLabel, timeLabel } from '../domain/format';

const entry = (type: string, to: string) => {
  const found = CATALOG[type]?.find((e) => e.to === to);
  if (!found) throw new Error(`no ${type} entry for ${to}`);
  return found;
};

const nimesha = {
  email: 'nimesha@waypoint.lk',
  phone: null,
  push: true,
};
const aniqa = {
  email: 'aniqa@drivers.waypoint.local',
  phone: '+94771234567',
  push: false,
};

describe('notification catalog and channels', () => {
  it('AC-NTF-01 One notification per event, person and channel', () => {
    const deferral = entry('deferral.confirmed', 'storeManagers');
    expect(channelsFor(deferral.channels, nimesha, null)).toEqual([
      'IN_APP',
      'EMAIL',
      'PUSH',
    ]);
    expect(dedupeKeyOf('e1', 'u1', 'EMAIL')).toBe('e1:u1:EMAIL');
  });

  it('AC-NTF-03 Preferences drop a channel but never in-app', () => {
    const deferral = entry('deferral.confirmed', 'storeManagers');
    expect(channelsFor(deferral.channels, nimesha, ['PUSH'])).toEqual([
      'IN_APP',
      'PUSH',
    ]);
    expect(channelsFor(deferral.channels, nimesha, [])).toEqual(['IN_APP']);
  });

  it("AC-NTF-04 Channels a person can't receive are dropped", () => {
    const trip = entry('plan.published', 'tripDrivers');
    expect(channelsFor(trip.channels, aniqa, null)).toEqual(['IN_APP', 'SMS']);
    expect(realEmail(aniqa.email)).toBeNull();
    expect(
      trip.message({}, { vehicleCode: 'REF-07', tripNo: 1, stops: 6 })?.body,
    ).toBe('Your trip: REF-07, Run 1, 6 stops.');
  });

  it('AC-NTF-05 Security messages ignore preferences', () => {
    expect(channelsFor(['SMS'], aniqa, [], true)).toEqual(['SMS']);
  });

  it('writes the spec examples word for word', () => {
    expect(
      entry('deferral.confirmed', 'storeManagers').message(
        {
          deferralId: 'd1',
          toDate: '2026-10-02',
          reasonCode: 'NO_REEFER_CAPACITY',
        },
        { orderNo: 'WF-0171' },
      ),
    ).toEqual({
      title: 'Order WF-0171 moves to Fri 2 Oct',
      body: 'Order WF-0171 moves to Fri 2 Oct: no reefer capacity.',
      link: '/store/deferrals/d1',
    });
    expect(
      entry('load.flag_raised', 'dispatchers').message(
        { tripId: 't1', qtyAffected: 2, reason: 'MISSING' },
        { vehicleCode: 'REF-07', outletName: 'Fresh Kadawatha' },
      )?.body,
    ).toBe('REF-07: 2 cases missing, Fresh Kadawatha.');
    expect(
      entry('trip.released', 'tripDrivers').message(
        {},
        {
          vehicleCode: 'REF-07',
          tripNo: 1,
          stops: 6,
          firstOutletName: 'Fresh Kadawatha',
          firstArrivalAt: '2026-10-01T22:40:00.000Z',
        },
      )?.body,
    ).toBe(
      'REF-07 trip 1 released. 6 stops, first Fresh Kadawatha at 04:10. Open the app to start.',
    );
    expect(
      entry('trip.cant_run', 'dispatchers').message(
        { reason: 'BREAKDOWN' },
        { vehicleCode: 'DRY-31' },
      )?.body,
    ).toBe("DRY-31 can't run: breakdown.");
  });

  it('a reassignment that keeps the vehicle tells the stores nothing', () => {
    const stores = entry('trip.reassigned', 'storeManagers');
    expect(stores.message({ vehicleChanged: false }, {})).toBeNull();
    expect(
      stores.message({ vehicleChanged: true }, { vehicleCode: 'DRY-12' })?.body,
    ).toBe('Your delivery is now on DRY-12.');
  });

  it('formats business dates and Colombo times', () => {
    expect(dayLabel('2026-10-02')).toBe('Fri 2 Oct');
    expect(dayLabel('nope')).toBeNull();
    expect(timeLabel('2026-10-01T22:40:00.000Z')).toBe('04:10');
    expect(consumes('plan.published')).toBe(true);
    expect(consumes('order.updated')).toBe(false);
  });
});
