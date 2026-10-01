// The engine's own copies of the domain enums, so it has no dependency on the API or the web app.
// The database enums are generated from these (specs/engine/rules.md, "Decided 2026-10-01").

export const BRANDS = ['FRESH', 'STYLE', 'TECH'] as const;
export type Brand = (typeof BRANDS)[number];

export const TEMP_CLASSES = ['AMBIENT', 'CHILLED'] as const;
export type TempClass = (typeof TEMP_CLASSES)[number];

export const VEHICLE_TYPES = ['TRUCK', 'VAN'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TEMPS = ['AMBIENT', 'REEFER'] as const;
export type VehicleTemp = (typeof VEHICLE_TEMPS)[number];

export const DOCK_TYPES = ['REAR_DOCK', 'STREET', 'MALL_BAY'] as const;
export type DockType = (typeof DOCK_TYPES)[number];

export const PARKING_CONSTRAINTS = ['NORMAL', 'VAN_ONLY', 'MALL_DOCK'] as const;
export type ParkingConstraint = (typeof PARKING_CONSTRAINTS)[number];
