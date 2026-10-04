import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
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
  CreateDepotWaveDto,
  DepotWaveDto,
  UpdateDepotWaveDto,
} from '../dto/depot-wave.dto';
import { DepotWaveLinks } from '../policies/depot-wave.links';
import { wholeList } from '../policies/whole-list';
import { DepotWavesService } from '../services/depot-waves.service';

/**
 * Run waves on A4: the departure bands ("Run 1" 05:15–06:30) a trip belongs
 * to. A handful of rows per depot, so the list comes back whole. Every route
 * needs `masterData:manage`, as Step 4's table says (AC-MD-07, AC-MD-12).
 */
@ApiTags('depots')
@Controller('depots/:depotId/waves')
export class DepotWavesController {
  constructor(
    private readonly waves: DepotWavesService,
    private readonly links: DepotWaveLinks,
  ) {}

  @Get()
  @RequirePermission('masterData:manage')
  @ApiPaginated(DepotWaveDto)
  @ApiOperation({ summary: "List a depot's run waves" })
  async list(@Param('depotId') depotId: string, @Actor() actor: SignedIn) {
    const rows = await this.waves.list(depotId);
    const self = `/api/v1/depots/${depotId}/waves`;
    return wholeList(this.links, rows, actor, self, {
      create: { href: self, method: 'POST', title: 'Add a wave' },
    });
  }

  @Post()
  @RequirePermission('masterData:manage')
  @ApiResource(DepotWaveDto, { status: 201 })
  @ApiProblems(400, 409)
  @ApiOperation({ summary: 'Add a run wave' })
  @HttpCode(201)
  async create(
    @Param('depotId') depotId: string,
    @Body() dto: CreateDepotWaveDto,
    @Actor() actor: SignedIn,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.waves.create(depotId, dto);
    res.setHeader('Location', `/api/v1/depots/${depotId}/waves/${row.id}`);
    return this.links.one(row, actor);
  }

  @Get(':id')
  @RequirePermission('masterData:manage')
  @ApiResource(DepotWaveDto)
  @ApiOperation({ summary: 'One run wave' })
  async get(
    @Param('depotId') depotId: string,
    @Param('id') id: string,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.waves.get(depotId, id), actor);
  }

  @Patch(':id')
  @RequirePermission('masterData:manage')
  @ApiResource(DepotWaveDto)
  @ApiProblems(400, 409)
  @ApiOperation({ summary: 'Edit a run wave' })
  async update(
    @Param('depotId') depotId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDepotWaveDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.waves.update(depotId, id, dto), actor);
  }

  /** Removed only while no trip sits in it; 409 otherwise. */
  @Delete(':id')
  @RequirePermission('masterData:manage')
  @ApiProblems(404, 409)
  @ApiOperation({ summary: 'Remove a run wave' })
  @HttpCode(204)
  async remove(
    @Param('depotId') depotId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.waves.remove(depotId, id);
  }
}
