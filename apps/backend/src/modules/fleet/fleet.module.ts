// apps/backend/src/modules/fleet/fleet.module.ts · owner: Tihara
// Vehicles, their status and the weekly fuel ledger.
// Spec: specs/fleet/spec.md. Tables: src/db/schema/fleet.ts.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { VehicleFuelController } from './controllers/vehicle-fuel.controller';
import { VehicleStatusController } from './controllers/vehicle-status.controller';
import { VehiclesController } from './controllers/vehicles.controller';
import { VehicleLinks } from './policies/vehicle.links';
import { VehicleScope } from './policies/vehicle.scope';
import { FuelLedgerService } from './services/fuel-ledger.service';
import { VehicleStatusService } from './services/vehicle-status.service';
import { VehicleQueries } from './services/vehicle.queries';
import { VehiclesService } from './services/vehicles.service';

@Module({
  imports: [AuditModule],
  controllers: [
    VehicleFuelController,
    VehicleStatusController,
    VehiclesController,
  ],
  providers: [
    VehicleScope,
    VehicleLinks,
    VehicleQueries,
    VehiclesService,
    FuelLedgerService,
    VehicleStatusService,
  ],
  // Planning reads the depot's fleet and the week's fuel for the engine, and
  // writes planned fuel at publish (specs/planning/spec.md).
  exports: [VehicleQueries, FuelLedgerService],
})
export class FleetModule {}
