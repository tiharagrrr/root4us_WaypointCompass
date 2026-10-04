/** Audit actions fleet writes (specs/fleet/spec.md, Events). */
export const FLEET_AUDIT = {
  vehicleStatusChanged: 'fleet.vehicle.status_changed',
} as const;

/** Outbox event types fleet emits; planning consumes a breakdown (repair, ROO-56). */
export const FLEET_EVENTS = {
  vehicleStatusChanged: 'vehicle.status_changed',
} as const;
