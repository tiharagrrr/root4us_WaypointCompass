import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Response } from 'express';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import {
  CreateInjectionDto,
  CreateSimulationDto,
  InjectionDto,
  SimulationDto,
} from '../dto/simulation.dto';
import { SimulationGate } from '../policies/simulation.gate';
import { SimulationLinks } from '../policies/simulation.links';
import { SimulationQueries } from '../services/simulation.queries';
import { SimulationService } from '../services/simulation.service';

/**
 * Simulation runs (specs/simulation/spec.md). Every route needs
 * simulation:run and answers 404 unless DEMO_MODE and SIMULATION_ENABLED are
 * both true. The run itself plays in the worker.
 */
@ApiTags('simulations')
@Controller('simulations')
export class SimulationsController {
  constructor(
    private readonly gate: SimulationGate,
    private readonly queries: SimulationQueries,
    private readonly runs: SimulationService,
    private readonly links: SimulationLinks,
  ) {}

  @Get()
  @RequirePermission('simulation:run')
  @ApiPaginated(SimulationDto)
  @ApiProblems(404)
  @ApiOperation({ summary: 'The newest simulation runs' })
  async list(@Actor() actor: SignedIn) {
    this.gate.assertEnabled();
    return this.links.list(await this.queries.list(actor), actor);
  }

  @Post()
  @RequirePermission('simulation:run')
  @ApiResource(SimulationDto, { status: 201 })
  @ApiProblems(409)
  @ApiOperation({ summary: 'Create a run, or replay one' })
  async create(
    @Body() dto: CreateSimulationDto,
    @Actor() actor: SignedIn,
    @Res({ passthrough: true }) res: Response,
  ) {
    const run = await this.runs.create(dto, actor);
    res.location(`/api/v1/simulations/${run.id}`);
    return this.links.one(run, actor);
  }

  @Get(':id')
  @RequirePermission('simulation:run')
  @ApiResource(SimulationDto)
  @ApiOperation({ summary: 'Status, simulated time and KPIs' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    this.gate.assertEnabled();
    return this.links.one(await this.queries.get(id, actor), actor);
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermission('simulation:run')
  @ApiResource(SimulationDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Start the run and hand it the demo clock' })
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.runs.start(id, actor), actor);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermission('simulation:run')
  @ApiResource(SimulationDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Hold simulated time' })
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.runs.pause(id, actor), actor);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermission('simulation:run')
  @ApiResource(SimulationDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Continue simulated time' })
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.runs.resume(id, actor), actor);
  }

  @Post(':id/stop')
  @HttpCode(200)
  @RequirePermission('simulation:run')
  @ApiResource(SimulationDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'End the run and compute its KPIs' })
  async stop(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.runs.stop(id, actor), actor);
  }

  @Post(':id/injections')
  @RequirePermission('simulation:run')
  @ApiResource(InjectionDto, { status: 201 })
  @ApiProblems(409)
  @ApiOperation({ summary: 'Add trouble at a simulated time' })
  async inject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInjectionDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.injection(await this.runs.inject(id, dto, actor));
  }
}
