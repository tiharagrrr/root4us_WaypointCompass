/**
 * Domain vocabulary shared by the API, the web app and the Datathon checks.
 * Every array here equals the Postgres enum of the same name in
 * apps/backend/src/db/schema/enums.ts (asserted by enums.spec.ts there), so a
 * schema change can't drift silently. Dataset values are upper-cased at
 * import: `van_only` becomes `VAN_ONLY`.
 */

export const BRANDS = ["FRESH", "STYLE", "TECH"] as const;
export type Brand = (typeof BRANDS)[number];

/** Depot ids; the dataset names are Peliyagoda and Kandy. */
export const DEPOTS = ["PLG", "KDY"] as const;
export type Depot = (typeof DEPOTS)[number];

/** How a depot id reads in the UI: the dock and dispatcher shells name their depot. */
export const DEPOT_NAMES: Record<Depot, string> = {
  PLG: "Peliyagoda",
  KDY: "Kandy",
};

/** Peliyagoda is the central distribution centre; Kandy is a regional depot. */
export const DEPOT_KINDS = ["CENTRAL", "REGIONAL"] as const;
export type DepotKind = (typeof DEPOT_KINDS)[number];

export const USER_ROLES = [
  "admin",
  "dispatcher",
  "loader",
  "driver",
  "store_manager",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TEMP_CLASSES = ["AMBIENT", "CHILLED"] as const;
export type TempClass = (typeof TEMP_CLASSES)[number];

export const DOCK_TYPES = ["REAR_DOCK", "STREET", "MALL_BAY"] as const;
export type DockType = (typeof DOCK_TYPES)[number];

export const PARKING_CONSTRAINTS = ["NORMAL", "VAN_ONLY", "MALL_DOCK"] as const;
export type ParkingConstraint = (typeof PARKING_CONSTRAINTS)[number];

export const ROAD_CLASSES = ["URBAN", "SUBURBAN", "HIGHWAY", "HILL"] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const VEHICLE_TYPES = ["TRUCK", "VAN"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TEMPS = ["AMBIENT", "REEFER"] as const;
export type VehicleTemp = (typeof VEHICLE_TEMPS)[number];

/** Persistent until someone marks the vehicle ACTIVE again. */
export const VEHICLE_STATUSES = ["ACTIVE", "WORKSHOP", "BREAKDOWN"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/** Order state machine: see machines/order.machine.ts. */
export const ORDER_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "CONFIRMED",
  "PLANNED",
  "DEFERRED",
  "LOADED",
  "IN_TRANSIT",
  "DELIVERED",
  "PARTIAL",
  "FAILED",
  "RECEIVED",
  "ISSUE_REPORTED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PLAN_STATUSES = ["DRAFT", "PUBLISHED", "CLOSED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const TRIP_STATUSES = [
  "RESERVED",
  "PLANNED",
  "LOADING",
  "RELEASED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const STOP_STATUSES = [
  "PENDING",
  "ARRIVED",
  "DELIVERED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

export const DELIVERY_OUTCOMES = [
  "DELIVERED",
  "PARTIAL",
  "REFUSED",
  "DAMAGED",
  "OUTLET_CLOSED",
] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

export const DEFERRAL_STATUSES = [
  "PROPOSED",
  "CONFIRMED",
  "REVERSED",
  "CANCELLED",
] as const;
export type DeferralStatus = (typeof DEFERRAL_STATUSES)[number];

export const DEFERRAL_SOURCES = [
  "ENGINE",
  "PLANNING",
  "LOAD_CHECK",
  "TRACKING",
] as const;
export type DeferralSource = (typeof DEFERRAL_SOURCES)[number];

/**
 * Why the engine left an order unplanned. UNAVOIDABLE: no feasible place
 * existed. PRIORITY_CHOICE: a higher-priority order took the space. Null on a
 * deferral nobody's engine run proposed (a manual or dock deferral).
 */
export const DEFERRAL_CHOICES = ["UNAVOIDABLE", "PRIORITY_CHOICE"] as const;
export type DeferralChoice = (typeof DEFERRAL_CHOICES)[number];

export const STORE_RESPONSES = [
  "AWAITING",
  "ACKNOWLEDGED",
  "PRIORITY_REQUESTED",
] as const;
export type StoreResponse = (typeof STORE_RESPONSES)[number];

export const LOAD_LINE_STATUSES = [
  "PENDING",
  "OK",
  "FLAGGED",
  "REPLACED",
  "REMOVED",
] as const;
export type LoadLineStatus = (typeof LOAD_LINE_STATUSES)[number];

export const LOAD_FLAG_REASONS = [
  "MISSING",
  "DAMAGED",
  "WRONG_TEMP",
  "OVER_CAPACITY",
] as const;
export type LoadFlagReason = (typeof LOAD_FLAG_REASONS)[number];

export const LOAD_FLAG_DECISIONS = ["REPLACE", "REMOVE"] as const;
export type LoadFlagDecision = (typeof LOAD_FLAG_DECISIONS)[number];

export const LOAD_FLAG_STATUSES = [
  "OPEN",
  "AWAITING_RECHECK",
  "RESOLVED",
] as const;
export type LoadFlagStatus = (typeof LOAD_FLAG_STATUSES)[number];

export const STOP_EVENT_TYPES = [
  "TRIP_DOWNLOADED",
  "TRIP_STARTED",
  "ARRIVED",
  "DELIVERED",
  "PARTIAL",
  "FAILED",
  "ISSUE_REPORTED",
  "CANT_RUN",
  "TRIP_COMPLETED",
] as const;
export type StopEventType = (typeof STOP_EVENT_TYPES)[number];

/** D8 Can't run this trip: the reason the driver picks, projected onto trips.cantRunReason. */
export const CANT_RUN_REASONS = [
  "BREAKDOWN",
  "COOLING",
  "UNWELL",
  "OTHER",
] as const;
export type CantRunReason = (typeof CANT_RUN_REASONS)[number];

export const SYNC_CONFLICT_RESOLUTIONS = [
  "KEEP_DEVICE",
  "KEEP_SERVER",
] as const;
export type SyncConflictResolution = (typeof SYNC_CONFLICT_RESOLUTIONS)[number];

export const RECEIPT_STATUSES = ["CONFIRMED", "CONFIRMED_WITH_ISSUES"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const ISSUE_TYPES = [
  "MISSING",
  "DAMAGED",
  "SHORT",
  "TEMPERATURE",
  "LATE",
  "OTHER",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_RESOLUTIONS = [
  "CREDIT_ISSUED",
  "CREDIT_REQUESTED",
  "REDELIVERY",
  "NO_ACTION",
] as const;
export type IssueResolution = (typeof ISSUE_RESOLUTIONS)[number];

export const ALERT_TYPES = [
  "LATE_RISK",
  "FAILED_STOP",
  "LOADER_SHORTFALL",
  "STORE_ISSUE",
  "DRIVER_CANT_RUN",
  "VEHICLE_OFFLINE",
  "PRIORITY_REQUEST",
  "SYNC_CONFLICT",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const ATTACHMENT_KINDS = [
  "POD_PHOTO",
  "SIGNATURE",
  "EXCEPTION_PHOTO",
  "FLAG_PHOTO",
  "ISSUE_PHOTO",
  "CANT_RUN_PHOTO",
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const NOTIFICATION_CHANNELS = [
  "IN_APP",
  "EMAIL",
  "SMS",
  "PUSH",
  "WHATSAPP",
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const INVITATION_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "EXPIRED",
  "REVOKED",
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Orders for the next day close at 4 PM Asia/Colombo (a depot may override it). */
export const ORDER_CUTOFF_LOCAL_TIME = "16:00";
export const BUSINESS_TIME_ZONE = "Asia/Colombo";

/** A vehicle may run at most two trips per day. */
export const MAX_TRIPS_PER_VEHICLE_PER_DAY = 2;
