import type { DockType, ParkingConstraint, VehicleStatus, VehicleTemp, VehicleType } from '@compass/api-client'
import type { StatusTone } from '@/ui/status-chip'

/** How A3 and A5 name the API's enums. Copy follows the Figma frames' wording. */

export const DOCK_LABELS: Record<DockType, string> = {
  REAR_DOCK: 'Rear dock',
  STREET: 'Street',
  MALL_BAY: 'Mall bay',
}

export const PARKING_LABELS: Record<ParkingConstraint, string> = {
  NORMAL: 'Normal parking',
  VAN_ONLY: 'Van only',
  MALL_DOCK: 'Mall dock',
}

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  TRUCK: 'Truck',
  VAN: 'Van',
}

export const VEHICLE_TEMP_LABELS: Record<VehicleTemp, string> = {
  AMBIENT: 'Ambient',
  REEFER: 'Reefer',
}

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  ACTIVE: 'Active',
  WORKSHOP: 'In workshop',
  BREAKDOWN: 'Broken down',
}

/** A vehicle out of service reads as a warning; a breakdown is the loud one. */
export const VEHICLE_STATUS_TONES: Record<VehicleStatus, StatusTone> = {
  ACTIVE: 'success',
  WORKSHOP: 'warning',
  BREAKDOWN: 'danger',
}
