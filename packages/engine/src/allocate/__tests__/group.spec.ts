import { describe, expect, it } from 'vitest';
import { allocContext } from '../context';
import { groupOrders } from '../groups';
import { rankOrders } from '../priority';
import type { EngineInput } from '../../types';
import { scenario } from './fixture';

const groupsOf = (input: EngineInput, freeSlots = 2) => {
  const ctx = allocContext(input);
  return groupOrders(ctx, rankOrders(ctx, input.orders), () => freeSlots);
};

describe('grouping', () => {
  it('group: orders key by brand, district and temperature class', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', temp: 'REEFER' }],
      districts: { 'fx-colombo': { depotToDistrictMin: 24, interStopMin: 8 } },
      orders: [
        { id: 'fx-ord-1', brand: 'FRESH', districtId: 'fx-gampaha', tempClass: 'CHILLED' },
        { id: 'fx-ord-2', brand: 'FRESH', districtId: 'fx-gampaha', tempClass: 'CHILLED' },
        { id: 'fx-ord-3', brand: 'FRESH', districtId: 'fx-gampaha' },
        { id: 'fx-ord-4', brand: 'FRESH', districtId: 'fx-colombo' },
        { id: 'fx-ord-5', brand: 'TECH', districtId: 'fx-gampaha' },
      ],
    });
    const groups = groupsOf(input);
    expect(
      groups.map((group) => [group.key, group.orders.map((entry) => entry.order.id)]),
    ).toEqual(
      expect.arrayContaining([
        ['FRESH|fx-gampaha|CHILLED', ['fx-ord-1', 'fx-ord-2']],
        ['FRESH|fx-gampaha|AMBIENT', ['fx-ord-3']],
        ['FRESH|fx-colombo|AMBIENT', ['fx-ord-4']],
        ['TECH|fx-gampaha|AMBIENT', ['fx-ord-5']],
      ]),
    );
    expect(groups).toHaveLength(4);
  });

  it('group: a van-only outlet stays in its group and marks it as needing a van', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', type: 'VAN' }, { id: 'fx-veh-2' }],
      outlets: { 'fx-out-1': { parkingConstraint: 'VAN_ONLY' }, 'fx-out-2': {} },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1' },
        { id: 'fx-ord-2', outletId: 'fx-out-2' },
      ],
    });
    const mixed = groupsOf(input)[0];
    expect(mixed).toMatchObject({ key: 'FRESH|fx-gampaha|AMBIENT', hasVanOnly: true, needsVan: false });
    expect(mixed?.orders.map((entry) => entry.order.id)).toEqual(['fx-ord-1', 'fx-ord-2']);
    // A group of nothing but van-only outlets can only be served by a van, so only vans count as room.
    const vanOnly = scenario({
      vehicles: [{ id: 'fx-veh-1', type: 'VAN' }, { id: 'fx-veh-2' }],
      outlets: { 'fx-out-1': { parkingConstraint: 'VAN_ONLY' } },
      orders: [{ id: 'fx-ord-1', outletId: 'fx-out-1' }],
    });
    expect(groupsOf(vanOnly)[0]).toMatchObject({ needsVan: true, preferredVehicleIds: ['fx-veh-1'] });
  });

  it('group: the scarcest group is packed first', () => {
    const input = scenario({
      vehicles: [
        { id: 'fx-veh-1', temp: 'REEFER', volumeCapM3: 2 },
        { id: 'fx-veh-2', volumeCapM3: 10 },
        { id: 'fx-veh-3', volumeCapM3: 10 },
      ],
      orders: [
        { id: 'fx-ord-1', tempClass: 'CHILLED', volumeM3: 1 },
        { id: 'fx-ord-2', tempClass: 'CHILLED', volumeM3: 1 },
        { id: 'fx-ord-3', tempClass: 'CHILLED', volumeM3: 1 },
        { id: 'fx-ord-4', volumeM3: 1 },
      ],
    });
    const groups = groupsOf(input);
    // Chilled: 3 m³ against one reefer's two 2 m³ trips (0.75). Ambient: 1 m³ against 40 m³ (0.025).
    expect(groups.map((group) => group.key)).toEqual([
      'FRESH|fx-gampaha|CHILLED',
      'FRESH|fx-gampaha|AMBIENT',
    ]);
    expect(groups[0]?.scarcity).toBeCloseTo(0.75, 5);
    expect(groups[0]?.preferredVehicleIds).toEqual(['fx-veh-1']);
    expect(groups[1]?.preferredVehicleIds).toEqual(['fx-veh-2', 'fx-veh-3']);
  });

  it('group: inside a priority band the order that fills the most of a vehicle goes first', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', volumeCapM3: 10 }],
      orders: [
        { id: 'fx-ord-1', volumeM3: 0.5 },
        { id: 'fx-ord-2', volumeM3: 4 },
        { id: 'fx-ord-3', volumeM3: 2 },
      ],
    });
    expect(groupsOf(input)[0]?.orders.map((entry) => entry.order.id)).toEqual([
      'fx-ord-2',
      'fx-ord-3',
      'fx-ord-1',
    ]);
  });
});
