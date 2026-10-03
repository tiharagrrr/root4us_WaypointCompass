import { CATALOG, adjustmentFor, catalogFor } from '../catalog';
import { historySourceDays, historyTargetDays, parseHistory } from '../history';
import { linesFor } from '../order-lines';
import { outletName } from '../outlet-names';
import { parseS1Fleet, parseS1Orders } from '../s1';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('demo day: catalog, lines and S1 parsing', () => {
  it('ROO-22 the catalog has 50 Fresh items (32 dry, 18 chilled), about 20 Style, about 15 Tech and one adjustment item per brand and class', () => {
    const shown = CATALOG.filter((i) => !i.isAdjustment);
    expect(
      shown.filter((i) => i.brand === 'FRESH' && i.tempClass === 'AMBIENT'),
    ).toHaveLength(32);
    expect(
      shown.filter((i) => i.brand === 'FRESH' && i.tempClass === 'CHILLED'),
    ).toHaveLength(18);
    expect(shown.filter((i) => i.brand === 'STYLE')).toHaveLength(20);
    expect(shown.filter((i) => i.brand === 'TECH')).toHaveLength(15);
    expect(
      CATALOG.filter((i) => i.isAdjustment)
        .map((i) => `${i.brand}:${i.tempClass}`)
        .sort(),
    ).toEqual([
      'FRESH:AMBIENT',
      'FRESH:CHILLED',
      'STYLE:AMBIENT',
      'TECH:AMBIENT',
    ]);
    expect(new Set(CATALOG.map((i) => i.sku)).size).toBe(CATALOG.length);
    // Only Fresh has chilled goods (specs/data/datasets.md, Known quirks).
    expect(
      CATALOG.filter((i) => i.tempClass === 'CHILLED' && i.brand !== 'FRESH'),
    ).toEqual([]);
  });

  it('ROO-22 order lines add up exactly to the order, the last one on the adjustment item', () => {
    for (const [ref, weightKg, volumeM3, tempClass] of [
      ['S1-T01', 1240, 4.2, 'CHILLED'],
      ['S1-T02', 640.5, 3.37, 'AMBIENT'],
      ['S1-T03', 12, 0.05, 'AMBIENT'],
    ] as const) {
      const items = catalogFor('FRESH', tempClass);
      const lines = linesFor(
        ref,
        { weightKg, volumeM3 },
        items,
        adjustmentFor('FRESH', tempClass),
      );
      expect(sum(lines.map((l) => l.qty * l.unitWeightKg))).toBeCloseTo(
        weightKg,
        6,
      );
      expect(sum(lines.map((l) => l.qty * l.unitVolumeM3))).toBeCloseTo(
        volumeM3,
        6,
      );
      expect(lines.at(-1)?.sku).toBe(adjustmentFor('FRESH', tempClass).sku);
      expect(
        lines.every(
          (l) => l.qty > 0 && l.unitWeightKg > 0 && l.unitVolumeM3 > 0,
        ),
      ).toBe(true);
      expect(new Set(lines.map((l) => l.sku)).size).toBe(lines.length);
      // The same order always gets the same lines.
      expect(
        linesFor(
          ref,
          { weightKg, volumeM3 },
          items,
          adjustmentFor('FRESH', tempClass),
        ),
      ).toEqual(lines);
    }
  });

  it('ROO-22 S1 rows map by header name, and a bad value fails loudly', () => {
    const rows = [
      {
        scenario: 'S1',
        order_ref: 'S1-T01',
        outlet_id: 'OUT901',
        brand: 'Fresh',
        district: 'Test',
        depot: 'Peliyagoda',
        temp_requirement: 'chilled',
        order_units: '10',
        order_weight_kg: '120.5',
        order_volume_m3: '1.25',
        deferred_yesterday: '1',
        days_since_last_served: '3',
      },
    ];
    expect(parseS1Orders(rows)).toEqual([
      {
        ref: 'S1-T01',
        outletId: 'OUT901',
        tempClass: 'CHILLED',
        units: 10,
        weightKg: 120.5,
        volumeM3: 1.25,
        deferredYesterday: true,
      },
    ]);
    expect(() =>
      parseS1Orders([{ ...rows[0], order_weight_kg: 'heavy' }]),
    ).toThrow(/order_weight_kg/);
    expect(
      parseS1Fleet([
        { scenario: 'S1', vehicle_id: 'VEH901', status: 'in_workshop' },
        { scenario: 'S1', vehicle_id: 'VEH902', status: 'available' },
      ]),
    ).toEqual({
      workshop: ['VEH901'],
      available: ['VEH902'],
    });
  });

  it('ROO-22 outlets are named "Brand Town", deterministically, and Fresh Kadawatha keeps its name', () => {
    expect(
      outletName({ id: 'OUT014', brand: 'FRESH', districtId: 'gampaha' }, 0),
    ).toBe('Fresh Kadawatha');
    expect(
      outletName({ id: 'OUT001', brand: 'FRESH', districtId: 'gampaha' }, 0),
    ).toMatch(/^Fresh [A-Z][a-z]/);
    expect(
      outletName({ id: 'OUT002', brand: 'STYLE', districtId: 'colombo' }, 1),
    ).toMatch(/^Style [A-Z]/);
    expect(
      outletName({ id: 'OUT003', brand: 'TECH', districtId: 'nowhere' }, 2),
    ).toBeNull();
  });

  /** An invented deliveries_train.csv row, with the booklet's header names. */
  const historyRow = (over: Record<string, string> = {}) => ({
    delivery_id: 'D901',
    order_date: '2025-03-03',
    dispatch_date: '2025-03-03',
    dispatch_status: 'attempted',
    outlet_id: 'OUT901',
    brand: 'Fresh',
    district: 'Test',
    depot: 'Peliyagoda',
    temp_requirement: 'ambient',
    order_units: '12',
    order_weight_kg: '300',
    order_volume_m3: '1.5',
    route_id: 'R901',
    seq_in_route: '0',
    vehicle_id: 'VEH901',
    vehicle_type: 'truck',
    vehicle_temp: 'ambient',
    planned_arrival_time: '05:45',
    window_open_time: '05:30',
    window_close_time: '07:30',
    ...over,
  });

  it('ROO-22 history rows map by header name, and a bad value fails loudly', () => {
    expect(parseHistory([historyRow()])).toEqual([
      {
        ref: 'D901',
        outletId: 'OUT901',
        orderDate: '2025-03-03',
        dispatchDate: '2025-03-03',
        status: 'attempted',
        tempClass: 'AMBIENT',
        units: 12,
        weightKg: 300,
        volumeM3: 1.5,
        routeId: 'R901',
        seq: 0,
        vehicleId: 'VEH901',
        plannedArrivalMin: 345,
        windowOpenMin: 330,
        windowCloseMin: 450,
      },
    ]);
    expect(
      parseHistory([
        historyRow({
          dispatch_status: 'not_run',
          dispatch_date: '',
          route_id: '',
          seq_in_route: '',
          vehicle_id: '',
          planned_arrival_time: '',
        }),
      ])[0],
    ).toMatchObject({
      dispatchDate: null,
      routeId: null,
      seq: null,
      vehicleId: null,
    });
    expect(() =>
      parseHistory([historyRow({ order_date: '03/03/2025' })]),
    ).toThrow(/order_date/);
    expect(() =>
      parseHistory([historyRow({ dispatch_status: 'lost' })]),
    ).toThrow(/dispatch_status/);
  });

  it("ROO-22 history is the operating days before D−1, and the file's last day is left for Kandy", () => {
    const rows = parseHistory(
      ['2025-03-01', '2025-03-03', '2025-03-04', '2025-03-05'].map((d, i) =>
        historyRow({ delivery_id: `D90${i}`, order_date: d, dispatch_date: d }),
      ),
    );
    expect(historySourceDays(rows, 2)).toEqual({
      history: ['2025-03-03', '2025-03-04'],
      last: '2025-03-05',
    });
    // D is Wednesday 2027-03-10; D−1 is the 9th. Sunday the 7th is skipped by default, and the
    // calendar's holiday on the 5th is skipped too.
    expect(
      historyTargetDays('2027-03-10', 3, (d) =>
        d === '2027-03-05' ? false : undefined,
      ),
    ).toEqual(['2027-03-04', '2027-03-06', '2027-03-08']);
  });
});
