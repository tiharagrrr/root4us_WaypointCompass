import { describe, expect, it } from 'vitest';
import { tripMinutes } from './trip-time';
import { validateVehicleDay, type ValidatorOrder, type ValidatorVehicle } from './allocation-validator';

// Worked examples from the Challenge Booklet (Task 2B, "Calculate trip time").
describe('tripMinutes', () => {
  it('matches the 101-minute Gampaha Fresh trip', () => {
    expect(
      tripMinutes({ outboundMin: 37, interStopMin: 9, handlingMin: [15, 15, 16] }),
    ).toBe(101);
  });

  it('matches the 112-minute Colombo Fresh trip', () => {
    expect(
      tripMinutes({ outboundMin: 24, interStopMin: 8, handlingMin: [16, 16, 16, 16] }),
    ).toBe(112);
  });

  it('has no inter-stop travel for a single stop and is zero with no stops', () => {
    expect(tripMinutes({ outboundMin: 30, interStopMin: 9, handlingMin: [15] })).toBe(45);
    expect(tripMinutes({ outboundMin: 30, interStopMin: 9, handlingMin: [] })).toBe(0);
  });
});

describe('validateVehicleDay', () => {
  const reeferTruck: ValidatorVehicle = {
    id: 'VEH014',
    type: 'TRUCK',
    temp: 'REEFER',
    depot: 'PLG',
    weightCapKg: 5000,
    volumeCapM3: 30,
    available: true,
  };
  const order = (ref: string, district: string, extra: Partial<ValidatorOrder> = {}): ValidatorOrder => ({
    ref,
    brand: 'FRESH',
    district,
    depot: 'PLG',
    tempClass: 'CHILLED',
    parkingConstraint: 'NORMAL',
    weightKg: 100,
    volumeM3: 1,
    ...extra,
  });

  it('accepts two Fresh trips using 213 of 270 minutes', () => {
    const trips = [
      { vehicleId: 'VEH014', tripNumber: 1, minutes: 101, orders: [order('A', 'Gampaha'), order('B', 'Gampaha'), order('C', 'Gampaha')] },
      { vehicleId: 'VEH014', tripNumber: 2, minutes: 112, orders: [order('D', 'Colombo'), order('E', 'Colombo')] },
    ];
    expect(validateVehicleDay(reeferTruck, trips)).toEqual([]);
  });

  it('flags a third trip, a busted Fresh budget, van-only access and mixed districts', () => {
    const trips = [
      { vehicleId: 'VEH014', tripNumber: 1, minutes: 101, orders: [order('A', 'Gampaha'), order('B', 'Colombo')] },
      { vehicleId: 'VEH014', tripNumber: 2, minutes: 112, orders: [order('C', 'Colombo', { parkingConstraint: 'VAN_ONLY' })] },
      { vehicleId: 'VEH014', tripNumber: 3, minutes: 90, orders: [order('D', 'Colombo')] },
    ];
    const rules = validateVehicleDay(reeferTruck, trips).map((v) => v.rule);
    expect(rules).toEqual(
      expect.arrayContaining(['brand_district', 'vehicle_access', 'max_trips', 'time_budget']),
    );
  });

  it('rejects chilled goods on an ambient vehicle', () => {
    const ambient = { ...reeferTruck, temp: 'AMBIENT' as const };
    const trips = [{ vehicleId: 'VEH014', tripNumber: 1, minutes: 50, orders: [order('A', 'Colombo')] }];
    expect(validateVehicleDay(ambient, trips).map((v) => v.rule)).toEqual(['refrigeration']);
  });
});
