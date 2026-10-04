// apps/backend/src/modules/simulation/simulation.module.ts · owner: Aniqa
// Drives a demo day through the public APIs.
// Spec: specs/simulation/spec.md. Tables: src/db/schema/simulation.ts.
import { Module } from '@nestjs/common';
import { ProvidersModule } from '../../core/providers/providers.module';
import { AuditModule } from '../audit';
import { ExecutionModule } from '../execution';
import { SimulationsController } from './controllers/simulations.controller';
import { SimulationGate } from './policies/simulation.gate';
import { SimulationLinks } from './policies/simulation.links';
import { SimulationScope } from './policies/simulation.scope';
import { SimulationDirector } from './services/simulation-director.service';
import { SimulationRunner } from './services/simulation-runner.service';
import { SimulationQueries } from './services/simulation.queries';
import { SimulationService } from './services/simulation.service';
import { VirtualDrivers } from './services/virtual-drivers.service';

/**
 * Simulation imports execution, for `StopEventService` (the one handler for a
 * field event, which the virtual drivers record through), and audit. Plans,
 * trips and stops are read straight from planning's tables, read-only. The
 * loop that plays a run is registered in the worker (SimulationLoop).
 */
@Module({
  imports: [AuditModule, ExecutionModule, ProvidersModule],
  controllers: [SimulationsController],
  providers: [
    SimulationDirector,
    SimulationGate,
    SimulationLinks,
    SimulationQueries,
    SimulationRunner,
    SimulationScope,
    SimulationService,
    VirtualDrivers,
  ],
  exports: [SimulationRunner],
})
export class SimulationModule {}
