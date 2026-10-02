import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRANDS, DOCK_TYPES } from '@waypoint/shared/domain';
import type { EngineInput, EngineOrder, EngineOutlet, EngineVehicle, Plan, Violation } from '../../types';
import type { EngineParams } from '../../params';

export const RULE_FIXTURE_DIR = join(__dirname, '../../../fixtures/rules');

export interface RuleFixture {
  rule: string;
  description: string;
  params: Partial<EngineParams>;
  input: Record<string, unknown>;
  plan: Plan;
  expect: Partial<Violation>[];
}

export function listFixtureFiles(): string[] {
  return readdirSync(RULE_FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

export function readFixture(file: string): RuleFixture {
  return JSON.parse(readFileSync(join(RULE_FIXTURE_DIR, file), 'utf8')) as RuleFixture;
}

// Fixtures list only what a case changes; these fill in the rest so the other rules stay quiet.
const allowances: Record<string, number> = {};
for (const brand of BRANDS) for (const dock of DOCK_TYPES) allowances[`${brand}:${dock}`] = 15;

const baseVehicle: Omit<EngineVehicle, 'id' | 'code'> = {
  depotId: 'fx-depot-1',
  type: 'TRUCK',
  temp: 'AMBIENT',
  weightCapKg: 1000,
  volumeCapM3: 10,
  kmPerL: 5,
  weeklyFuelQuotaL: 500,
  available: true,
  unavailableReason: null,
};
const baseOutlet: Omit<EngineOutlet, 'id'> = {
  depotId: 'fx-depot-1',
  dockType: 'REAR_DOCK',
  parkingConstraint: 'NORMAL',
  windowOpenMin: 0,
  windowCloseMin: 1440,
  mallWindowOpenMin: null,
  mallWindowCloseMin: null,
  styleDeliveryDow: null,
};
const baseOrder: Omit<EngineOrder, 'id' | 'ref' | 'outletId'> = {
  brand: 'FRESH',
  districtId: 'fx-gampaha',
  tempClass: 'AMBIENT',
  weightKg: 10,
  volumeM3: 0.1,
  valueLkr: null,
  urgent: false,
};
const baseDistrict = {
  depotToDistrictMin: 37,
  interStopMin: 9,
  depotToDistrictKm: 22,
  interStopKm: 5,
};

type Partials = Record<string, unknown>;
const asPartials = (v: unknown): Partials => (v ?? {}) as Partials;

export function buildInput(raw: Record<string, unknown>, params: Partial<EngineParams> = {}): EngineInput {
  const vehicles = (raw['vehicles'] as Partials[]).map((v) => ({
    ...baseVehicle,
    code: String(v['id']).replace('fx-veh-', 'FV'),
    ...v,
  })) as unknown as EngineVehicle[];
  const outlets: Record<string, EngineOutlet> = {};
  for (const [id, o] of Object.entries(asPartials(raw['outlets']))) {
    outlets[id] = { ...baseOutlet, id, ...asPartials(o) } as EngineOutlet;
  }
  const districts: EngineInput['districts'] = {
    'fx-gampaha': { id: 'fx-gampaha', ...baseDistrict },
  };
  const rawDistricts = asPartials(raw['districts']);
  const merged: Record<string, EngineInput['districts'][string]> = { ...districts };
  for (const [id, d] of Object.entries(rawDistricts)) {
    merged[id] = { ...baseDistrict, id, ...asPartials(d) } as EngineInput['districts'][string];
  }
  const orders = (raw['orders'] as Partials[]).map((o) => ({
    ...baseOrder,
    ref: String(o['id']).replace('fx-ord-', 'FO-'),
    ...o,
  })) as unknown as EngineOrder[];
  return {
    date: (raw['date'] as string | undefined) ?? '2026-10-02',
    isOperatingDay: (raw['isOperatingDay'] as boolean | undefined) ?? true,
    vehicles,
    outlets,
    districts: merged,
    allowances: { ...allowances, ...asPartials(raw['allowances']) } as Record<string, number>,
    orders,
    history: asPartials(raw['history']) as EngineInput['history'],
    fuelUsedThisWeek: asPartials(raw['fuelUsedThisWeek']) as Record<string, number>,
    fixedTrips: [],
    params,
  };
}
