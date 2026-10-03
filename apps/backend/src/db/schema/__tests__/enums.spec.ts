/**
 * packages/shared keeps its own enum arrays for the web app. This test fails when
 * either side changes alone, so the schema and the UI can't drift silently.
 */
import * as shared from '@waypoint/shared';
import * as enums from '../enums';

const pairs: [string, readonly string[], readonly string[]][] = [
  ['brand', enums.brandEnum.enumValues, shared.BRANDS],
  ['depot_kind', enums.depotKindEnum.enumValues, shared.DEPOT_KINDS],
  ['temp_class', enums.tempClassEnum.enumValues, shared.TEMP_CLASSES],
  ['vehicle_type', enums.vehicleTypeEnum.enumValues, shared.VEHICLE_TYPES],
  ['vehicle_temp', enums.vehicleTempEnum.enumValues, shared.VEHICLE_TEMPS],
  [
    'vehicle_status',
    enums.vehicleStatusEnum.enumValues,
    shared.VEHICLE_STATUSES,
  ],
  ['dock_type', enums.dockTypeEnum.enumValues, shared.DOCK_TYPES],
  [
    'parking_constraint',
    enums.parkingEnum.enumValues,
    shared.PARKING_CONSTRAINTS,
  ],
  ['road_class', enums.roadClassEnum.enumValues, shared.ROAD_CLASSES],
  ['order_status', enums.orderStatusEnum.enumValues, shared.ORDER_STATUSES],
  ['plan_status', enums.planStatusEnum.enumValues, shared.PLAN_STATUSES],
  ['trip_status', enums.tripStatusEnum.enumValues, shared.TRIP_STATUSES],
  ['stop_status', enums.stopStatusEnum.enumValues, shared.STOP_STATUSES],
  [
    'delivery_outcome',
    enums.deliveryOutcomeEnum.enumValues,
    shared.DELIVERY_OUTCOMES,
  ],
  [
    'deferral_status',
    enums.deferralStatusEnum.enumValues,
    shared.DEFERRAL_STATUSES,
  ],
  [
    'deferral_choice',
    enums.deferralChoiceEnum.enumValues,
    shared.DEFERRAL_CHOICES,
  ],
  [
    'deferral_source',
    enums.deferralSourceEnum.enumValues,
    shared.DEFERRAL_SOURCES,
  ],
  [
    'store_response',
    enums.storeResponseEnum.enumValues,
    shared.STORE_RESPONSES,
  ],
  [
    'cant_run_reason',
    enums.cantRunReasonEnum.enumValues,
    shared.CANT_RUN_REASONS,
  ],
  [
    'load_line_status',
    enums.loadLineStatusEnum.enumValues,
    shared.LOAD_LINE_STATUSES,
  ],
  [
    'load_flag_reason',
    enums.loadFlagReasonEnum.enumValues,
    shared.LOAD_FLAG_REASONS,
  ],
  [
    'load_flag_decision',
    enums.loadFlagDecisionEnum.enumValues,
    shared.LOAD_FLAG_DECISIONS,
  ],
  [
    'load_flag_status',
    enums.loadFlagStatusEnum.enumValues,
    shared.LOAD_FLAG_STATUSES,
  ],
  [
    'stop_event_type',
    enums.stopEventTypeEnum.enumValues,
    shared.STOP_EVENT_TYPES,
  ],
  [
    'sync_conflict_resolution',
    enums.syncResolutionEnum.enumValues,
    shared.SYNC_CONFLICT_RESOLUTIONS,
  ],
  [
    'receipt_status',
    enums.receiptStatusEnum.enumValues,
    shared.RECEIPT_STATUSES,
  ],
  ['issue_type', enums.issueTypeEnum.enumValues, shared.ISSUE_TYPES],
  ['issue_status', enums.issueStatusEnum.enumValues, shared.ISSUE_STATUSES],
  [
    'issue_resolution',
    enums.issueResolutionEnum.enumValues,
    shared.ISSUE_RESOLUTIONS,
  ],
  ['alert_type', enums.alertTypeEnum.enumValues, shared.ALERT_TYPES],
  ['alert_status', enums.alertStatusEnum.enumValues, shared.ALERT_STATUSES],
  [
    'attachment_kind',
    enums.attachmentKindEnum.enumValues,
    shared.ATTACHMENT_KINDS,
  ],
  [
    'notification_channel',
    enums.notificationChannelEnum.enumValues,
    shared.NOTIFICATION_CHANNELS,
  ],
  [
    'invitation_status',
    enums.invitationStatusEnum.enumValues,
    shared.INVITATION_STATUSES,
  ],
];

describe('Postgres enums match packages/shared', () => {
  it.each(pairs)('%s', (_name, db, web) => {
    expect([...db]).toEqual([...web]);
  });
});
