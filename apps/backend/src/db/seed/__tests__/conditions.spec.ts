import {
  knownDistrictsOnly,
  parseRoadConditions,
  parseTrafficSpeeds,
} from '../conditions';

/** Hand-made rows (specs/data/datasets.md): never the dataset itself. */
const traffic = [
  { district: 'Gampaha', hour: '5', monsoon: '0', speed_index: '100' },
  { district: 'Gampaha', hour: '08:00', monsoon: '1', speed_index: '62.5' },
  { district: 'Nuwara Eliya', hour: '17', monsoon: '0', speed_index: '70' },
];

describe('traffic_speed.csv', () => {
  it('maps by header name, slugs the district and reads the hour as a number or a clock time', () => {
    expect(parseTrafficSpeeds(traffic)).toEqual([
      { districtId: 'gampaha', hour: 5, monsoon: false, speedIndex: 100 },
      { districtId: 'gampaha', hour: 8, monsoon: true, speedIndex: 62.5 },
      { districtId: 'nuwara-eliya', hour: 17, monsoon: false, speedIndex: 70 },
    ]);
  });

  it('accepts the other likely spellings of the key columns', () => {
    expect(
      parseTrafficSpeeds([
        {
          district_name: 'Kandy',
          hour_of_day: '12',
          monsoon: '1',
          speed_index: '55',
        },
      ]),
    ).toEqual([
      { districtId: 'kandy', hour: 12, monsoon: true, speedIndex: 55 },
    ]);
  });

  it('fails loudly when no column names the district or the hour, or an hour is out of range', () => {
    expect(() =>
      parseTrafficSpeeds([
        { zone: 'Kandy', hour: '1', monsoon: '0', speed_index: '90' },
      ]),
    ).toThrow(/no district column/);
    expect(() =>
      parseTrafficSpeeds([
        { district: 'Kandy', slot: '1', monsoon: '0', speed_index: '90' },
      ]),
    ).toThrow(/no hour column/);
    expect(() =>
      parseTrafficSpeeds([
        { district: 'Kandy', hour: '24', monsoon: '0', speed_index: '90' },
      ]),
    ).toThrow(/row 2: hour "24"/);
  });

  it('parses nothing from an empty file', () => {
    expect(parseTrafficSpeeds([])).toEqual([]);
  });
});

describe('road_conditions.csv', () => {
  it('maps by header name and insists on YYYY-MM-DD dates', () => {
    expect(
      parseRoadConditions([
        { date: '2026-10-05', district: 'Colombo', disruption_index: '100' },
        { date: '2026-10-05', district: 'Matale', disruption_index: '40' },
      ]),
    ).toEqual([
      { date: '2026-10-05', districtId: 'colombo', disruptionIndex: 100 },
      { date: '2026-10-05', districtId: 'matale', disruptionIndex: 40 },
    ]);
    expect(() =>
      parseRoadConditions([
        { date: '05/10/2026', district: 'Colombo', disruption_index: '100' },
      ]),
    ).toThrow(/not YYYY-MM-DD/);
  });
});

describe('knownDistrictsOnly', () => {
  it('keeps the rows whose district the reference data has and counts the rest', () => {
    const rows = parseTrafficSpeeds(traffic);
    const result = knownDistrictsOnly(rows, new Set(['gampaha']));
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toBe(1);
  });
});
