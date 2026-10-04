// The fleet module's public surface: other modules import from this file only.
export { FleetModule } from './fleet.module';
export { FLEET_EVENTS } from './fleet.constants';
export { VehicleQueries, type VehicleRow } from './services/vehicle.queries';
export {
  FuelLedgerService,
  type FuelWeek,
  type IsoWeek,
  type PlannedFuel,
} from './services/fuel-ledger.service';
