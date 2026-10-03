import { describe, expect, it } from 'vitest';
import { explain, explainUnplanned } from '../../explain';
import { allocate } from '../index';
import { scenario } from './fixture';

/** One reefer, three chilled orders of 0.95 m³: its two trips fill to 95% and one order waits. */
const reeferBound = () =>
  scenario({
    vehicles: [{ id: 'fx-veh-1', temp: 'REEFER', volumeCapM3: 1 }],
    districts: { 'fx-gampaha': { name: 'Gampaha' } },
    outlets: { 'fx-out-1': {}, 'fx-out-2': {}, 'fx-out-3': {} },
    orders: [
      { id: 'fx-ord-1', outletId: 'fx-out-1', volumeM3: 0.95, tempClass: 'CHILLED', units: 5 },
      { id: 'fx-ord-2', outletId: 'fx-out-2', volumeM3: 0.95, tempClass: 'CHILLED', units: 5 },
      { id: 'fx-ord-3', outletId: 'fx-out-3', volumeM3: 0.95, tempClass: 'CHILLED', units: 7 },
    ],
  });

describe('explain', () => {
  it('explain: the plan sentence names the limiting resource and what waits', () => {
    const input = reeferBound();
    const output = allocate(input);
    expect(output.stats.limiting.map((r) => r.resource)).toEqual(['REEFER_VOLUME']);
    expect(explain(input, output).plan).toBe(
      'Reefer capacity was the limit: 2 of 2 reefer trips are full (95% of volume). ' +
        '1 chilled Fresh order waits; 1 was unavoidable and 0 made room for outlets skipped yesterday.',
    );
  });

  it('explain: an unplanned order reads as a sentence with its own numbers', () => {
    const input = reeferBound();
    const output = allocate(input);
    const waiting = output.unplanned[0];
    if (!waiting) throw new Error('the scenario plans every order');
    expect(explainUnplanned(input, waiting)).toBe(
      'FO-3 waits: it needs 0.95 m³ chilled, and the most space left on any Gampaha reefer trip is ' +
        '0.05 m³ (FV1 trip 1). Tried FV1.',
    );
    expect(explain(input, output).unplanned).toEqual([
      { orderId: 'fx-ord-3', ref: 'FO-3', sentence: explainUnplanned(input, waiting) },
    ]);
  });

  it('explain: the resource lines read out what each scarce resource cost', () => {
    const input = reeferBound();
    const output = allocate(input);
    expect(explain(input, output).resources).toEqual([
      'Reefer capacity: 1.9 of 2 m³ used (95%); 2 of 2 reefer trips are full.',
      'Fresh minutes: 104 of 270 min used (39%); 2 of 2 Fresh trips are full.',
      'Style and Tech minutes: 0 of 480 min used (0%).',
      'The weekly fuel quota: 17.6 of 500 L used (4%).',
    ]);
  });

  it('explain: the deferral lines split what was unavoidable from what was a choice', () => {
    const input = reeferBound();
    const output = allocate(input);
    expect(output.stats.unavoidable).toEqual({
      orders: 1,
      units: 7,
      volumeM3: 0.95,
      weightKg: 10,
      outlets: 1,
    });
    expect(output.stats.chosen.orders).toBe(0);
    expect(explain(input, output).deferrals).toEqual([
      '1 deferral was unavoidable: 7 units, 0.95 m³, 1 outlet.',
    ]);
  });

  it('explain: a deferral that made room says so, and counts the repeat skips', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', temp: 'REEFER', volumeCapM3: 1 }],
      districts: { 'fx-gampaha': { name: 'Gampaha' } },
      outlets: { 'fx-out-1': {}, 'fx-out-2': {} },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1', volumeM3: 0.6, units: 3 },
        { id: 'fx-ord-2', outletId: 'fx-out-2', volumeM3: 0.5, tempClass: 'CHILLED' },
      ],
      history: {
        'fx-out-1': { deferredOnLastRun: true, consecutiveDeferrals: 1, daysSinceLastServed: 0 },
        'fx-out-2': { deferredOnLastRun: true, consecutiveDeferrals: 3, daysSinceLastServed: 10 },
      },
      params: { maxTripsPerVehicle: 1 },
    });
    const output = allocate(input);
    expect(output.stats).toMatchObject({
      repeatSkipsAvoided: 1,
      repeatSkipsIncurred: 1,
      chosen: { orders: 1, units: 3, volumeM3: 0.6, weightKg: 10, outlets: 1 },
    });
    expect(explain(input, output).deferrals).toEqual([
      '1 deferral made room for a higher-priority order: 3 units, 0.6 m³, 1 outlet.',
      '1 order for outlets deferred on their last run is served today.',
      '1 outlet is deferred for a second run in a row and needs a written note.',
    ]);
  });

  it('explain: a plan with nothing waiting says so', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 2 }],
      orders: [{ id: 'fx-ord-1' }, { id: 'fx-ord-2' }],
    });
    const output = allocate(input);
    expect(explain(input, output).plan).toBe('Every order is planned: 2 orders on 1 trip.');
    expect(explain(input, output).deferrals).toEqual([]);
  });
});
