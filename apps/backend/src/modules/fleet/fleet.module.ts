// apps/backend/src/modules/fleet/fleet.module.ts · owner: Tihara
// Vehicles, their status and the weekly fuel ledger.
// Spec: specs/fleet/spec.md. Tables: src/db/schema/fleet.ts.
import { Module } from '@nestjs/common';
import { VehicleFuelController } from './controllers/vehicle-fuel.controller';
import { VehicleScope } from './policies/vehicle.scope';
import { FuelLedgerService } from './services/fuel-ledger.service';
import { VehicleQueries } from './services/vehicle.queries';

@Module({
  imports: [],
  controllers: [VehicleFuelController],
  providers: [VehicleScope, VehicleQueries, FuelLedgerService],
  // Planning reads the depot's fleet and the week's fuel for the engine, and
  // writes planned fuel at publish (specs/planning/spec.md).
  exports: [VehicleQueries, FuelLedgerService],
})
export class FleetModule {}
