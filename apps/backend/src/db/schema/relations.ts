// apps/backend/src/db/schema/relations.ts: one relations() per table that services read with `with`.
// relationName disambiguates tables joined by more than one key (orders ↔ stops, orders ↔ deferrals).
import { relations } from 'drizzle-orm';
import { alerts } from './alerts';
import { deliveryLines, positionPings, stopEvents } from './execution';
import { fuelLedgerEntries, vehicles } from './fleet';
import { capacityPlans } from './forecasting';
import {
  accounts,
  devices,
  invitations,
  loaderDepots,
  sessions,
  users,
} from './identity';
import { loadCheckLines, loadFlags } from './loading';
import { depots, depotWaves, districts, items, outlets } from './master-data';
import { notifications } from './notifications';
import {
  orderLines,
  orders,
  orderTemplateLines,
  orderTemplates,
  receivingRosterEntries,
} from './ordering';
import {
  deferralReasons,
  deferrals,
  engineRuns,
  planRevisions,
  plans,
  stops,
  trips,
} from './planning';
import { issues, receiptLines, receipts } from './receipt';
import { simulationInjections, simulationRuns } from './simulation';
import { syncConflicts } from './sync';
import { webhookDeliveries, webhookEndpoints } from './webhooks';

// Master data and fleet
export const depotsRelations = relations(depots, ({ many }) => ({
  waves: many(depotWaves),
  districts: many(districts),
  outlets: many(outlets),
  vehicles: many(vehicles),
  plans: many(plans),
  capacityPlans: many(capacityPlans),
}));
export const depotWavesRelations = relations(depotWaves, ({ one }) => ({
  depot: one(depots, { fields: [depotWaves.depotId], references: [depots.id] }),
}));
export const districtsRelations = relations(districts, ({ one, many }) => ({
  depot: one(depots, { fields: [districts.depotId], references: [depots.id] }),
  outlets: many(outlets),
}));
export const outletsRelations = relations(outlets, ({ one, many }) => ({
  depot: one(depots, { fields: [outlets.depotId], references: [depots.id] }),
  district: one(districts, {
    fields: [outlets.districtId],
    references: [districts.id],
  }),
  orders: many(orders),
  templates: many(orderTemplates),
  roster: many(receivingRosterEntries),
  issues: many(issues),
  managers: many(users),
}));
export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  depot: one(depots, { fields: [vehicles.depotId], references: [depots.id] }),
  trips: many(trips),
  fuelEntries: many(fuelLedgerEntries),
  pings: many(positionPings),
}));
export const fuelLedgerEntriesRelations = relations(
  fuelLedgerEntries,
  ({ one }) => ({
    vehicle: one(vehicles, {
      fields: [fuelLedgerEntries.vehicleId],
      references: [vehicles.id],
    }),
    trip: one(trips, {
      fields: [fuelLedgerEntries.tripId],
      references: [trips.id],
    }),
  }),
);

// Identity and notifications
export const usersRelations = relations(users, ({ one, many }) => ({
  depot: one(depots, { fields: [users.depotId], references: [depots.id] }),
  outlet: one(outlets, { fields: [users.outletId], references: [outlets.id] }),
  defaultVehicle: one(vehicles, {
    fields: [users.defaultVehicleId],
    references: [vehicles.id],
  }),
  loaderDepots: many(loaderDepots),
  sessions: many(sessions),
  accounts: many(accounts),
  devices: many(devices),
  trips: many(trips),
  notifications: many(notifications),
}));
export const loaderDepotsRelations = relations(loaderDepots, ({ one }) => ({
  user: one(users, { fields: [loaderDepots.userId], references: [users.id] }),
  depot: one(depots, {
    fields: [loaderDepots.depotId],
    references: [depots.id],
  }),
}));
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));
export const devicesRelations = relations(devices, ({ one }) => ({
  user: one(users, { fields: [devices.userId], references: [users.id] }),
}));
export const invitationsRelations = relations(invitations, ({ one }) => ({
  invitedBy: one(users, {
    fields: [invitations.invitedById],
    references: [users.id],
  }),
}));
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

// Ordering
export const ordersRelations = relations(orders, ({ one, many }) => ({
  outlet: one(outlets, { fields: [orders.outletId], references: [outlets.id] }),
  placedBy: one(users, { fields: [orders.placedById], references: [users.id] }),
  template: one(orderTemplates, {
    fields: [orders.templateId],
    references: [orderTemplates.id],
  }),
  lines: many(orderLines),
  stops: many(stops, { relationName: 'order_stops' }),
  activeStop: one(stops, {
    fields: [orders.activeStopId],
    references: [stops.id],
    relationName: 'order_active_stop',
  }),
  parent: one(orders, {
    fields: [orders.parentOrderId],
    references: [orders.id],
    relationName: 'order_backorders',
  }),
  backorders: many(orders, { relationName: 'order_backorders' }),
  deferrals: many(deferrals, { relationName: 'deferral_order' }),
  receipt: one(receipts),
  issues: many(issues),
}));
export const orderLinesRelations = relations(orderLines, ({ one }) => ({
  order: one(orders, { fields: [orderLines.orderId], references: [orders.id] }),
  item: one(items, { fields: [orderLines.itemId], references: [items.id] }),
}));
export const orderTemplatesRelations = relations(
  orderTemplates,
  ({ one, many }) => ({
    outlet: one(outlets, {
      fields: [orderTemplates.outletId],
      references: [outlets.id],
    }),
    lines: many(orderTemplateLines),
  }),
);
export const orderTemplateLinesRelations = relations(
  orderTemplateLines,
  ({ one }) => ({
    template: one(orderTemplates, {
      fields: [orderTemplateLines.templateId],
      references: [orderTemplates.id],
    }),
    item: one(items, {
      fields: [orderTemplateLines.itemId],
      references: [items.id],
    }),
  }),
);
export const receivingRosterEntriesRelations = relations(
  receivingRosterEntries,
  ({ one }) => ({
    outlet: one(outlets, {
      fields: [receivingRosterEntries.outletId],
      references: [outlets.id],
    }),
  }),
);

// Planning
export const plansRelations = relations(plans, ({ one, many }) => ({
  depot: one(depots, { fields: [plans.depotId], references: [depots.id] }),
  trips: many(trips),
  revisions: many(planRevisions),
  engineRuns: many(engineRuns),
  deferrals: many(deferrals),
}));
export const planRevisionsRelations = relations(planRevisions, ({ one }) => ({
  plan: one(plans, { fields: [planRevisions.planId], references: [plans.id] }),
}));
export const engineRunsRelations = relations(engineRuns, ({ one, many }) => ({
  plan: one(plans, { fields: [engineRuns.planId], references: [plans.id] }),
  deferrals: many(deferrals),
}));
export const tripsRelations = relations(trips, ({ one, many }) => ({
  plan: one(plans, { fields: [trips.planId], references: [plans.id] }),
  vehicle: one(vehicles, {
    fields: [trips.vehicleId],
    references: [vehicles.id],
  }),
  driver: one(users, { fields: [trips.driverId], references: [users.id] }),
  district: one(districts, {
    fields: [trips.districtId],
    references: [districts.id],
  }),
  wave: one(depotWaves, {
    fields: [trips.waveId],
    references: [depotWaves.id],
  }),
  stops: many(stops),
  loadLines: many(loadCheckLines),
  loadFlags: many(loadFlags),
  events: many(stopEvents),
  fuelEntries: many(fuelLedgerEntries),
}));
export const stopsRelations = relations(stops, ({ one, many }) => ({
  trip: one(trips, { fields: [stops.tripId], references: [trips.id] }),
  order: one(orders, {
    fields: [stops.orderId],
    references: [orders.id],
    relationName: 'order_stops',
  }),
  outlet: one(outlets, { fields: [stops.outletId], references: [outlets.id] }),
  events: many(stopEvents),
  deliveryLines: many(deliveryLines),
}));
export const deferralReasonsRelations = relations(
  deferralReasons,
  ({ many }) => ({ deferrals: many(deferrals) }),
);
export const deferralsRelations = relations(deferrals, ({ one }) => ({
  order: one(orders, {
    fields: [deferrals.orderId],
    references: [orders.id],
    relationName: 'deferral_order',
  }),
  swappedFor: one(orders, {
    fields: [deferrals.swappedForOrderId],
    references: [orders.id],
    relationName: 'deferral_swap',
  }),
  plan: one(plans, { fields: [deferrals.planId], references: [plans.id] }),
  engineRun: one(engineRuns, {
    fields: [deferrals.engineRunId],
    references: [engineRuns.id],
  }),
  reason: one(deferralReasons, {
    fields: [deferrals.reasonCode],
    references: [deferralReasons.code],
  }),
}));

// Loading
export const loadCheckLinesRelations = relations(
  loadCheckLines,
  ({ one, many }) => ({
    trip: one(trips, {
      fields: [loadCheckLines.tripId],
      references: [trips.id],
    }),
    order: one(orders, {
      fields: [loadCheckLines.orderId],
      references: [orders.id],
    }),
    orderLine: one(orderLines, {
      fields: [loadCheckLines.orderLineId],
      references: [orderLines.id],
    }),
    flags: many(loadFlags),
  }),
);
export const loadFlagsRelations = relations(loadFlags, ({ one }) => ({
  trip: one(trips, { fields: [loadFlags.tripId], references: [trips.id] }),
  line: one(loadCheckLines, {
    fields: [loadFlags.loadLineId],
    references: [loadCheckLines.id],
  }),
}));

// Execution and sync
export const stopEventsRelations = relations(stopEvents, ({ one }) => ({
  trip: one(trips, { fields: [stopEvents.tripId], references: [trips.id] }),
  stop: one(stops, { fields: [stopEvents.stopId], references: [stops.id] }),
  conflict: one(syncConflicts),
}));
export const deliveryLinesRelations = relations(deliveryLines, ({ one }) => ({
  stop: one(stops, { fields: [deliveryLines.stopId], references: [stops.id] }),
  orderLine: one(orderLines, {
    fields: [deliveryLines.orderLineId],
    references: [orderLines.id],
  }),
}));
export const positionPingsRelations = relations(positionPings, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [positionPings.vehicleId],
    references: [vehicles.id],
  }),
  trip: one(trips, { fields: [positionPings.tripId], references: [trips.id] }),
}));
export const syncConflictsRelations = relations(syncConflicts, ({ one }) => ({
  event: one(stopEvents, {
    fields: [syncConflicts.stopEventId],
    references: [stopEvents.id],
  }),
}));

// Receipt, issues and alerts
export const receiptsRelations = relations(receipts, ({ one, many }) => ({
  order: one(orders, { fields: [receipts.orderId], references: [orders.id] }),
  stop: one(stops, { fields: [receipts.stopId], references: [stops.id] }),
  confirmedBy: one(users, {
    fields: [receipts.confirmedById],
    references: [users.id],
  }),
  lines: many(receiptLines),
  issues: many(issues),
}));
export const receiptLinesRelations = relations(receiptLines, ({ one }) => ({
  receipt: one(receipts, {
    fields: [receiptLines.receiptId],
    references: [receipts.id],
  }),
  orderLine: one(orderLines, {
    fields: [receiptLines.orderLineId],
    references: [orderLines.id],
  }),
}));
export const issuesRelations = relations(issues, ({ one }) => ({
  outlet: one(outlets, { fields: [issues.outletId], references: [outlets.id] }),
  order: one(orders, { fields: [issues.orderId], references: [orders.id] }),
  stop: one(stops, { fields: [issues.stopId], references: [stops.id] }),
  receipt: one(receipts, {
    fields: [issues.receiptId],
    references: [receipts.id],
  }),
  orderLine: one(orderLines, {
    fields: [issues.orderLineId],
    references: [orderLines.id],
  }),
}));
export const alertsRelations = relations(alerts, ({ one }) => ({
  depot: one(depots, { fields: [alerts.depotId], references: [depots.id] }),
}));

// Forecasting
export const capacityPlansRelations = relations(capacityPlans, ({ one }) => ({
  depot: one(depots, {
    fields: [capacityPlans.depotId],
    references: [depots.id],
  }),
}));

// Webhooks and simulation
export const webhookEndpointsRelations = relations(
  webhookEndpoints,
  ({ many }) => ({ deliveries: many(webhookDeliveries) }),
);
export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    endpoint: one(webhookEndpoints, {
      fields: [webhookDeliveries.endpointId],
      references: [webhookEndpoints.id],
    }),
  }),
);
export const simulationRunsRelations = relations(
  simulationRuns,
  ({ many }) => ({ injections: many(simulationInjections) }),
);
export const simulationInjectionsRelations = relations(
  simulationInjections,
  ({ one }) => ({
    run: one(simulationRuns, {
      fields: [simulationInjections.runId],
      references: [simulationRuns.id],
    }),
  }),
);
