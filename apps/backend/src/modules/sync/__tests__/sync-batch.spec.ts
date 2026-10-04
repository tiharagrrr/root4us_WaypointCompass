import {
  inDeviceOrder,
  parseEvent,
  rawClientUuid,
  rawSeq,
  tally,
} from '../domain/sync-batch';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const driver = (seq: number, type = 'ARRIVED') => ({
  clientUuid: uuid(seq),
  tripId: uuid(900),
  stopId: uuid(901),
  type,
  occurredAt: '2026-10-02T04:12:05+05:30',
  deviceSeq: seq,
});

describe('sync batch helpers', () => {
  it('AC-SYN-01 orders a batch by deviceSeq, arrival order breaking ties and absent ones last', () => {
    const batch = [
      driver(13),
      driver(11),
      { ...driver(99), deviceSeq: undefined },
      driver(12),
      { ...driver(12), clientUuid: uuid(120) },
    ];
    expect(inDeviceOrder(batch, rawSeq).map((e) => e.clientUuid)).toEqual([
      uuid(11),
      uuid(12),
      uuid(120),
      uuid(13),
      uuid(99),
    ]);
  });

  it('tells a driver event from a loader event by its type', () => {
    expect(parseEvent(driver(1)).kind).toBe('driver');
    expect(
      parseEvent({
        clientUuid: uuid(2),
        tripId: uuid(900),
        type: 'LOAD_LINE_CHECKED',
        occurredAt: '2026-10-02T02:45:10+05:30',
        loadLineId: uuid(50),
        qtyLoaded: 12,
        checkedByName: 'Harini De Mel',
      }).kind,
    ).toBe('loader');
  });

  it('AC-SYN-03 names what is wrong with an event that fails the wire contract', () => {
    const parsed = parseEvent({ ...driver(3), type: 'TELEPORTED' });
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind === 'invalid')
      expect(parsed.errors.some((e) => e.field === 'type')).toBe(true);
    expect(rawClientUuid({ clientUuid: uuid(3) })).toBe(uuid(3));
    expect(rawClientUuid('garbage')).toBe('unknown');
  });

  it('counts a batch so received is the sum of the four verdicts', () => {
    expect(
      tally([
        { clientUuid: 'a', status: 'applied' },
        { clientUuid: 'b', status: 'applied' },
        { clientUuid: 'c', status: 'duplicate' },
        { clientUuid: 'd', status: 'conflict' },
        { clientUuid: 'e', status: 'rejected' },
      ]),
    ).toEqual({
      received: 5,
      applied: 2,
      duplicates: 1,
      conflicts: 1,
      rejected: 1,
    });
  });
});
