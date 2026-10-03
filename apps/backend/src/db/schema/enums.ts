// apps/backend/src/db/schema/enums.ts · owner: core
// Every enum is a Postgres enum, and services take their types straight from it.
// packages/shared keeps the same arrays for the web app; enums.spec.ts asserts they match.
import { pgEnum } from 'drizzle-orm/pg-core';

// Master data and fleet
export const brandEnum = pgEnum('brand', ['FRESH', 'STYLE', 'TECH']);
export const depotKindEnum = pgEnum('depot_kind', ['CENTRAL', 'REGIONAL']);
export const tempClassEnum = pgEnum('temp_class', ['AMBIENT', 'CHILLED']);
export const vehicleTypeEnum = pgEnum('vehicle_type', ['TRUCK', 'VAN']);
export const vehicleTempEnum = pgEnum('vehicle_temp', ['AMBIENT', 'REEFER']);
export const vehicleStatusEnum = pgEnum('vehicle_status', [
  'ACTIVE',
  'WORKSHOP',
  'BREAKDOWN',
]);
export const dockTypeEnum = pgEnum('dock_type', [
  'REAR_DOCK',
  'STREET',
  'MALL_BAY',
]);
export const parkingEnum = pgEnum('parking_constraint', [
  'NORMAL',
  'VAN_ONLY',
  'MALL_DOCK',
]);
export const roadClassEnum = pgEnum('road_class', [
  'URBAN',
  'SUBURBAN',
  'HIGHWAY',
  'HILL',
]);
export const fuelEntryKindEnum = pgEnum('fuel_entry_kind', [
  'PLANNED',
  'ACTUAL',
  'ADJUSTMENT',
]);

// Ordering and planning
export const orderStatusEnum = pgEnum('order_status', [
  'DRAFT',
  'SUBMITTED',
  'CONFIRMED',
  'PLANNED',
  'DEFERRED',
  'LOADED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIAL',
  'FAILED',
  'RECEIVED',
  'ISSUE_REPORTED',
  'CANCELLED',
]);
export const planStatusEnum = pgEnum('plan_status', [
  'DRAFT',
  'PUBLISHED',
  'CLOSED',
]);
export const tripStatusEnum = pgEnum('trip_status', [
  'RESERVED',
  'PLANNED',
  'LOADING',
  'RELEASED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);
export const stopStatusEnum = pgEnum('stop_status', [
  'PENDING',
  'ARRIVED',
  'DELIVERED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
]);
export const deliveryOutcomeEnum = pgEnum('delivery_outcome', [
  'DELIVERED',
  'PARTIAL',
  'REFUSED',
  'DAMAGED',
  'OUTLET_CLOSED',
]);
export const deferralStatusEnum = pgEnum('deferral_status', [
  'PROPOSED',
  'CONFIRMED',
  'REVERSED',
  'CANCELLED',
]);
export const deferralSourceEnum = pgEnum('deferral_source', [
  'ENGINE',
  'PLANNING',
  'LOAD_CHECK',
  'TRACKING',
]);
/** Why the engine left an order unplanned (packages/shared DEFERRAL_CHOICES). */
export const deferralChoiceEnum = pgEnum('deferral_choice', [
  'UNAVOIDABLE',
  'PRIORITY_CHOICE',
]);
export const storeResponseEnum = pgEnum('store_response', [
  'AWAITING',
  'ACKNOWLEDGED',
  'PRIORITY_REQUESTED',
]);
export const cantRunReasonEnum = pgEnum('cant_run_reason', [
  'BREAKDOWN',
  'COOLING',
  'UNWELL',
  'OTHER',
]);
export const engineModeEnum = pgEnum('engine_mode', ['AUTO_SUGGEST', 'REPAIR']);
export const engineRunStatusEnum = pgEnum('engine_run_status', [
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
]);

// Loading, execution and sync
export const loadLineStatusEnum = pgEnum('load_line_status', [
  'PENDING',
  'OK',
  'FLAGGED',
  'REPLACED',
  'REMOVED',
]);
export const loadFlagReasonEnum = pgEnum('load_flag_reason', [
  'MISSING',
  'DAMAGED',
  'WRONG_TEMP',
  'OVER_CAPACITY',
]);
export const loadFlagDecisionEnum = pgEnum('load_flag_decision', [
  'REPLACE',
  'REMOVE',
]);
export const loadFlagStatusEnum = pgEnum('load_flag_status', [
  'OPEN',
  'AWAITING_RECHECK',
  'RESOLVED',
]);
export const stopEventTypeEnum = pgEnum('stop_event_type', [
  'TRIP_DOWNLOADED',
  'TRIP_STARTED',
  'ARRIVED',
  'DELIVERED',
  'PARTIAL',
  'FAILED',
  'ISSUE_REPORTED',
  'CANT_RUN',
  'TRIP_COMPLETED',
]);
export const syncConflictStatusEnum = pgEnum('sync_conflict_status', [
  'OPEN',
  'RESOLVED',
]);
export const syncResolutionEnum = pgEnum('sync_conflict_resolution', [
  'KEEP_DEVICE',
  'KEEP_SERVER',
]);

// Receipt, issues and alerts
export const receiptStatusEnum = pgEnum('receipt_status', [
  'CONFIRMED',
  'CONFIRMED_WITH_ISSUES',
]);
export const issueTypeEnum = pgEnum('issue_type', [
  'MISSING',
  'DAMAGED',
  'SHORT',
  'TEMPERATURE',
  'LATE',
  'OTHER',
]);
export const issueStatusEnum = pgEnum('issue_status', [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
]);
export const issueResolutionEnum = pgEnum('issue_resolution', [
  'CREDIT_ISSUED',
  'CREDIT_REQUESTED',
  'REDELIVERY',
  'NO_ACTION',
]);
export const alertTypeEnum = pgEnum('alert_type', [
  'LATE_RISK',
  'FAILED_STOP',
  'LOADER_SHORTFALL',
  'STORE_ISSUE',
  'DRIVER_CANT_RUN',
  'VEHICLE_OFFLINE',
  'PRIORITY_REQUEST',
  'SYNC_CONFLICT',
]);
export const alertStatusEnum = pgEnum('alert_status', [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
]);

// Platform
export const attachmentKindEnum = pgEnum('attachment_kind', [
  'POD_PHOTO',
  'SIGNATURE',
  'EXCEPTION_PHOTO',
  'FLAG_PHOTO',
  'ISSUE_PHOTO',
  'CANT_RUN_PHOTO',
]);
export const auditSourceEnum = pgEnum('audit_source', [
  'WEB',
  'PWA',
  'OFFLINE_SYNC',
  'ENGINE',
  'SYSTEM',
  'SIMULATION',
  'WEBHOOK',
]);
export const notificationChannelEnum = pgEnum('notification_channel', [
  'IN_APP',
  'EMAIL',
  'SMS',
  'PUSH',
  'WHATSAPP',
]);
export const notificationStatusEnum = pgEnum('notification_status', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'READ',
  'SUPPRESSED',
]);
export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'DEAD',
]);
export const invitationStatusEnum = pgEnum('invitation_status', [
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED',
]);
export const devicePlatformEnum = pgEnum('device_platform', [
  'WEB',
  'PWA',
  'FLUTTER',
]);

// Forecasting and simulation
export const forecastSourceEnum = pgEnum('forecast_source', [
  'BASELINE',
  'DATATHON',
]);
export const simulationStatusEnum = pgEnum('simulation_status', [
  'DRAFT',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
]);
export const injectionKindEnum = pgEnum('injection_kind', [
  'VEHICLE_BREAKDOWN',
  'DRIVER_OFFLINE',
  'ROAD_DELAY',
  'FAILED_DELIVERY',
  'LOAD_SHORTFALL',
  'STORE_ISSUE',
  'DEMAND_SPIKE',
]);
