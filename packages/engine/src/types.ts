import type {
  Brand,
  DockType,
  ParkingConstraint,
  TempClass,
  VehicleTemp,
  VehicleType,
} from '@waypoint/shared/domain';
import type { EngineParams } from './params';
import type {
  BindingRule,
  DeferralChoice,
  ExclusionCode,
  ScarceResource,
  RuleCode,
  RuleScope,
  Severity,
} from './rules/codes';
import type { DeferralReasonCode } from './rules/reason-map';

/** Times are minutes after midnight, Asia/Colombo. Weight kg, volume m3, distance km, fuel litres. */
export interface EngineDistrict {
  id: string;
  /** For the sentences explain() writes; the id is used when it is absent. */
  name?: string;
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
  /** Items or cases, as the orders data counts them. Deferral cost is reported in units. */
  units: number;
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
  /** The vehicle's slot in the day's plan: 1 or 2 in storage; the TRIP_LIMIT rule catches more. */
  tripNo: number;
  brand: Brand;
  districtId: string;
  /** In stop order. */
  orderIds: readonly string[];
  /** Trip minutes from the time model, return leg excluded. */
  minutes: number;
  km: number;
  litres: number;
  weightKg: number;
  volumeM3: number;
  /** Minutes after midnight. When absent the schedule derives it. */
  departMin?: number;
  /** Built or edited by hand (trips.locked). allocate() keeps these only in keepLocked mode. */
  locked?: boolean;
  /** A plan-ahead reservation (trips.isReserved): it holds a slot and is filled before a new trip opens. */
  reserved?: boolean;
}

/** A trip as the allocator or the plan editor proposes it; validate() measures it. */
export interface TripDraft {
  key?: string;
  vehicleId: string;
  tripNo: number;
  brand: Brand;
  districtId: string;
  orderIds: readonly string[];
  departMin?: number;
  locked?: boolean;
  reserved?: boolean;
}

/** One vehicle the allocator tried for an order, and the rule that ruled it out. */
export interface TriedVehicle {
  vehicleId: string;
  failedRule: BindingRule;
}

/** The numbers behind a deferral: what the order needed and the most room any legal trip had left. */
export interface UnplannedDetail {
  needUnits: number;
  needWeightKg: number;
  needVolumeM3: number;
  /** The most volume left on any trip the order could legally have joined; null when there was none. */
  bestVolumeM3: number | null;
  bestTripKey: string | null;
  bestVehicleId: string | null;
  bestTripNo: number | null;
}

export interface Unplanned {
  orderId: string;
  reasonCode: DeferralReasonCode;
  /** The rule that ruled out the last candidate vehicle tried. */
  bindingRule: BindingRule | null;
  choice: DeferralChoice;
  priority: number;
  repeatSkip: boolean;
  detail?: UnplannedDetail;
  tried?: readonly TriedVehicle[];
  /** The order that took this one's place, on a PRIORITY_CHOICE. */
  displacedBy?: string;
}

/**
 * An order the allocator left out of the plan altogether: not a deferral, no store notice. It is a
 * rare signal that something upstream went wrong, and the API raises an alert for it.
 */
export interface Excluded {
  orderId: string;
  code: ExclusionCode;
  message: string;
}

export interface Plan {
  trips: readonly TripDraft[];
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
  /**
   * Trips built or edited by hand. With keepLocked they are kept as they are and planned around;
   * without it they are ignored and their orders planned again, so their orders stay in `orders`.
   */
  lockedTrips?: readonly TripDraft[];
  /** Plan-ahead reservations: trips with no stops that hold a vehicle's capacity and trip slot. */
  reservedTrips?: readonly TripDraft[];
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

/** What a rule's check() receives. Which of trip, vehicle, vehicleTrips and unplannedOrder are set depends on the rule's scope. */
export interface RuleContext {
  readonly input: EngineInput;
  readonly params: EngineParams;
  /** Every trip in the plan, fixed trips included, measured and sorted by key. */
  readonly trips: readonly Trip[];
  readonly unplanned: readonly Unplanned[];
  readonly orderById: ReadonlyMap<string, EngineOrder>;
  /** Day of the week of the plan date, 0 = Monday. Checked once, up front, by validate(). */
  readonly planDow: number;
  readonly trip?: Trip;
  readonly vehicle?: EngineVehicle;
  readonly vehicleTrips?: readonly Trip[];
  readonly unplannedOrder?: Unplanned;
}

/** How much of one scarce resource the plan used, and whether it is what held the plan back. */
export interface ResourceUse {
  resource: ScarceResource;
  /** Minutes, m³ or litres, depending on the resource. */
  used: number;
  total: number;
  /** round(used / total × 100); 0 when the fleet has none of this resource. */
  pct: number;
  /** What `used` and `total` count, for the sentence: "volume", "trips", "minutes", "litres". */
  measure: string;
  /** The unit those numbers are in: "m³", "trips", "min", "L". */
  unit: string;
  /** Trips of this kind that could take no more of it, and how many there are in all. */
  fullTrips: number;
  trips: number;
  /** A deferral's binding rule points at this resource. */
  causedDeferrals: boolean;
  /** Used past params.limitingUtilisationPct and the cause of at least one deferral. */
  limiting: boolean;
}

/** What a set of deferrals costs: the booklet asks for units, m³ and outlets. */
export interface DeferralCost {
  orders: number;
  units: number;
  volumeM3: number;
  weightKg: number;
  outlets: number;
}

export interface ServedCount {
  served: number;
  deferred: number;
}

export interface PlanStats {
  orders: number;
  served: number;
  deferred: number;
  excluded: number;
  trips: number;
  byBrand: Readonly<Record<Brand, ServedCount>>;
  byTempClass: Readonly<Record<TempClass, ServedCount>>;
  /** In SCARCE_RESOURCES order. */
  resources: readonly ResourceUse[];
  /** The resources that held the plan back, most used first. */
  limiting: readonly ResourceUse[];
  /** Outlets deferred on their last run that this plan serves, and that it defers again. */
  repeatSkipsAvoided: number;
  repeatSkipsIncurred: number;
  unavoidable: DeferralCost;
  chosen: DeferralCost;
}

/**
 * What allocate() returns. It is also a Plan, so `validate(input, allocate(input))` type-checks and
 * measures the same trips. Fixed trips are not repeated here; validate() adds them from the input.
 */
export interface EngineOutput {
  version: string;
  date: string;
  trips: readonly Trip[];
  unplanned: readonly Unplanned[];
  excluded: readonly Excluded[];
  /** Every rule over the finished plan. HARD violations can only come from fixed or locked trips. */
  violations: readonly Violation[];
  stats: PlanStats;
}
