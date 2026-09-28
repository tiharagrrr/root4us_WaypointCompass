/**
 * Domain vocabulary shared by the API, the web app and the Datathon checks.
 * Values mirror the challenge datasets (outlets.csv, vehicles.csv, ...).
 */

export const BRANDS = ['Fresh', 'Style', 'Tech'] as const;
export type Brand = (typeof BRANDS)[number];

export const DEPOTS = ['Peliyagoda', 'Kandy'] as const;
export type Depot = (typeof DEPOTS)[number];

export const USER_ROLES = [
  'dispatcher',
  'loader',
  'driver',
  'store_manager',
  'admin',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DOCK_TYPES = ['rear_dock', 'street', 'mall_bay'] as const;
export type DockType = (typeof DOCK_TYPES)[number];

export const PARKING_CONSTRAINTS = ['normal', 'van_only', 'mall_dock'] as const;
export type ParkingConstraint = (typeof PARKING_CONSTRAINTS)[number];

export const VEHICLE_TYPES = ['truck', 'van'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TEMPS = ['reefer', 'ambient'] as const;
export type VehicleTemp = (typeof VEHICLE_TEMPS)[number];

export const VEHICLE_STATUSES = ['available', 'in_workshop'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const TEMP_REQUIREMENTS = ['chilled', 'ambient'] as const;
export type TempRequirement = (typeof TEMP_REQUIREMENTS)[number];

/** Order state machine (see docs/data-model.md). */
export const ORDER_STATUSES = [
  'placed',
  'confirmed',
  'planned',
  'deferred',
  'loaded',
  'out_for_delivery',
  'delivered',
  'failed',
  'received',
  'disputed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Machine reason codes for deferrals; a free-text note is added by people. */
export const DEFERRAL_REASONS = [
  'reefer_capacity',
  'van_shortage',
  'vehicle_capacity',
  'time_budget',
  'fuel_quota',
  'window_conflict',
  'manual',
] as const;
export type DeferralReason = (typeof DEFERRAL_REASONS)[number];

export const STOP_EVENT_TYPES = [
  'trip_started',
  'arrived',
  'delivered',
  'partially_delivered',
  'failed',
  'issue_reported',
] as const;
export type StopEventType = (typeof STOP_EVENT_TYPES)[number];

/** Orders for the next day close at 4 PM Asia/Colombo. */
export const ORDER_CUTOFF_LOCAL_TIME = '16:00';
export const BUSINESS_TIME_ZONE = 'Asia/Colombo';

/** A vehicle may run at most two trips per day. */
export const MAX_TRIPS_PER_VEHICLE_PER_DAY = 2;
