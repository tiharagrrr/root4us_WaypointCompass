import {
  coversEveryLine,
  type ExpectedLine,
  findDiscrepancies,
} from '../discrepancies';

const lines: ExpectedLine[] = [
  {
    orderLineId: 'l1',
    name: 'Basmati rice 5 kg',
    qtyExpected: 12,
    qtyDelivered: 12,
  },
  {
    orderLineId: 'l2',
    name: 'Coconut oil 1 L',
    qtyExpected: 12,
    qtyDelivered: 12,
  },
];

describe('findDiscrepancies', () => {
  it('finds nothing when every line is in full and ok', () => {
    expect(
      findDiscrepancies(lines, [
        { orderLineId: 'l1', qtyReceived: 12, condition: 'ok' },
        { orderLineId: 'l2', qtyReceived: 12, condition: 'ok' },
      ]),
    ).toEqual([]);
  });

  it('opens a SHORT issue for a short line, affecting the shortfall', () => {
    expect(
      findDiscrepancies(
        lines,
        [
          { orderLineId: 'l1', qtyReceived: 12, condition: 'ok' },
          { orderLineId: 'l2', qtyReceived: 10, condition: 'short' },
        ],
        '2 trays short',
      ),
    ).toEqual([
      {
        orderLineId: 'l2',
        type: 'SHORT',
        qtyAffected: 2,
        description: '2 trays short',
      },
    ]);
  });

  it('treats fewer packs than delivered as short even when the condition says ok', () => {
    const [issue] = findDiscrepancies(lines, [
      { orderLineId: 'l1', qtyReceived: 9, condition: 'ok' },
      { orderLineId: 'l2', qtyReceived: 12, condition: 'ok' },
    ]);
    expect(issue).toMatchObject({
      orderLineId: 'l1',
      type: 'SHORT',
      qtyAffected: 3,
    });
  });

  it('maps each bad condition to its issue type and affects the whole line when nothing is short', () => {
    const issues = findDiscrepancies(lines, [
      {
        orderLineId: 'l1',
        qtyReceived: 12,
        condition: 'damaged',
        note: 'crushed',
      },
      { orderLineId: 'l2', qtyReceived: 12, condition: 'temperature' },
    ]);
    expect(issues.map((i) => [i.type, i.qtyAffected])).toEqual([
      ['DAMAGED', 12],
      ['TEMPERATURE', 12],
    ]);
    expect(issues[0].description).toBe('crushed');
    expect(issues[1].description).toBe('Coconut oil 1 L: 12 temperature');
  });

  it('accepts a partial delivery the store takes as delivered (AC-RCP-04)', () => {
    const partial: ExpectedLine[] = [
      { orderLineId: 'l1', name: 'Rice', qtyExpected: 12, qtyDelivered: 10 },
    ];
    expect(
      findDiscrepancies(partial, [
        { orderLineId: 'l1', qtyReceived: 10, condition: 'ok' },
      ]),
    ).toEqual([]);
  });

  it('checks against the order when the driver has not synced yet', () => {
    const early: ExpectedLine[] = [
      { orderLineId: 'l1', name: 'Rice', qtyExpected: 12, qtyDelivered: null },
    ];
    expect(
      findDiscrepancies(early, [
        { orderLineId: 'l1', qtyReceived: 12, condition: 'ok' },
      ]),
    ).toEqual([]);
    expect(
      findDiscrepancies(early, [
        { orderLineId: 'l1', qtyReceived: 11, condition: 'ok' },
      ])[0].qtyAffected,
    ).toBe(1);
  });
});

describe('coversEveryLine', () => {
  it('reports lines that are missing, unknown or repeated', () => {
    expect(
      coversEveryLine(lines, [
        { orderLineId: 'l1', qtyReceived: 1, condition: 'ok' },
        { orderLineId: 'l1', qtyReceived: 1, condition: 'ok' },
        { orderLineId: 'zz', qtyReceived: 1, condition: 'ok' },
      ]),
    ).toEqual({ missing: ['l2'], unknown: ['zz'], repeated: ['l1'] });
  });

  it('is empty when the answer matches the order', () => {
    expect(
      coversEveryLine(lines, [
        { orderLineId: 'l2', qtyReceived: 1, condition: 'ok' },
        { orderLineId: 'l1', qtyReceived: 1, condition: 'ok' },
      ]),
    ).toEqual({ missing: [], unknown: [], repeated: [] });
  });
});
