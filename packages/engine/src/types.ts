import type {
  Brand,
  DockType,
  ParkingConstraint,
  TempClass,
  VehicleTemp,
  VehicleType,
} from './domain';
import type { EngineParams } from './params';
import type { BindingRule, DeferralChoice, RuleCode, RuleScope, Severity } from './rules/codes';

/** Times are minutes after midnight, Asia/Colombo. Weight kg, volume m3, distance km, fuel litres. */
export interface EngineDistrict {
  id: string;
  depotToDistrictMin: number;
  interStopMin: number;
  depotToDistrictKm: number;
  interStopKm: number;
}

/** Service allowance minutes, keyed "<BRAND>:<DOCK_TYPE>", for example "FRESH:REAR_DOCK". */
export type AllowanceTable = Readonly<Record<string, number>>;

export interface EngineOutlet {
  id: string;
  depotId: string;
  dockType: DockType;
  parkingConstraint: ParkingConstraint;
  windowOpenMin: number;
  windowCloseMin: number;
  mallWindowOpenMin: number | null;
  mallWindowCloseMin: number | null;
  /** Style's weekly delivery day, 0 = Monday; null when the outlet has none. */
  styleDeliveryDow: number | null;
}

export interface EngineVehicle {
  id: string;
  code: string;
  depotId: string;
  type: VehicleType;
  temp: VehicleTemp;
  weightCapKg: number;
  volumeCapM3: number;
  kmPerL: number;
  weeklyFuelQuotaL: number;
  available: boolean;
  unavailableReason: 'WORKSHOP' | 'BREAKDOWN' | null;
}

export interface EngineOrder {
  id: string;
  ref: string;
  outletId: string;
  brand: Brand;
  districtId: string;
  tempClass: TempClass;
  weightKg: number;
  volumeM3: number;
  valueLkr: number | null;
  urgent: boolean;
}

/** Computed by the API from deferrals and orders; the engine never reads a database. */
export interface FairnessHistory {
  deferredOnLastRun: boolean;
  consecutiveDeferrals: number;
  daysSinceLastServed: number;
}

export interface Trip {
  /** "<vehicle code>#<tripNo>", for example "REF-07#1". */
  key: string;
  vehicleId: string;
  tripNo: 1 | 2;
  brand: Brand;
  districtId: string;
  orderIds: readonly string[];
  /** Booklet formula, return leg excluded. */
  minutes: number;
  km: number;
  litres: number;
  weightKg: number;
  volumeM3: number;
}

export interface Unplanned {
  orderId: string;
  reasonCode: string;
  bindingRule: BindingRule | null;
  choice: DeferralChoice;
  priority: number;
  repeatSkip: boolean;
}

export interface Plan {
  trips: readonly Trip[];
  unplanned: readonly Unplanned[];
}

export interface EngineInput {
  /** The plan date, YYYY-MM-DD, Asia/Colombo. */
  date: string;
  /** calendar_days.isOperating for the plan date. */
  isOperatingDay: boolean;
  vehicles: readonly EngineVehicle[];
  outlets: Readonly<Record<string, EngineOutlet>>;
  districts: Readonly<Record<string, EngineDistrict>>;
  allowances: AllowanceTable;
  orders: readonly EngineOrder[];
  history: Readonly<Record<string, FairnessHistory>>;
  /** Litres planned or used this ISO week, per vehicle id. */
  fuelUsedThisWeek: Readonly<Record<string, number>>;
  /** Released or in-progress trips that repair mode must not touch. */
  fixedTrips: readonly Trip[];
  /** Overrides of DEFAULT_PARAMS. */
  params?: Partial<EngineParams>;
}

export interface Violation {
  rule: RuleCode;
  severity: Severity;
  scope: RuleScope;
  tripKey?: string;
  vehicleId?: string;
  orderId?: string;
  actual?: number;
  limit?: number;
  message: string;
}

/** What a rule's check() receives. A clean result is []. */
export interface RuleContext {
  readonly input: EngineInput;
  readonly params: EngineParams;
  readonly plan: Plan;
  readonly trip?: Trip;
  readonly vehicle?: EngineVehicle;
}
