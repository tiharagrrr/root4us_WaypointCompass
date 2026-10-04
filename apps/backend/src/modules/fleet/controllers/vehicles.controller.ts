import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Request } from 'express';
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  IfMatch,
  RequirePermission,
} from '../../../core/http/decorators';
import { UpdateVehicleDto, VehicleDto } from '../dto/vehicle.dto';
import { VehicleLinks } from '../policies/vehicle.links';
import { VehicleQueries } from '../services/vehicle.queries';
import { VehiclesService } from '../services/vehicles.service';
import { VEHICLE_RESOURCE } from '../vehicle.resource';

/**
 * Vehicles on A5, and the cards 06 and 09 read. Everyone with
 * `masterData:read` may look; only an admin edits. A vehicle outside the
 * caller's depot is a 404, never a 403 (AC-FLT-06).
 */
@ApiTags('vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(
    private readonly queries: VehicleQueries,
    private readonly vehicles: VehiclesService,
    private readonly links: VehicleLinks,
  ) {}

  @Get()
  @RequirePermission('masterData:read')
  @ApiPaginated(VehicleDto, { resource: VEHICLE_RESOURCE })
  @ApiOperation({ summary: 'List vehicles' })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    const page = await this.queries.list(query, actor);
    return this.links.page(page, actor, req);
  }

  @Get(':id')
  @RequirePermission('masterData:read')
  @ApiResource(VehicleDto)
  @ApiOperation({ summary: 'One vehicle' })
  async get(@Param('id') id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.queries.view(id, actor), actor);
  }

  /** A5: capacities, fuel figures and codes, with If-Match (AC-FLT-07). */
  @Patch(':id')
  @RequirePermission('masterData:manage')
  @ApiResource(VehicleDto)
  @ApiProblems(400)
  @ApiOperation({ summary: 'Edit a vehicle' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    await this.vehicles.edit(id, dto, version, actor);
    // Read it back for the driver A5 shows beside the row; the read runs in
    // the same transaction as the write.
    return this.links.one(await this.queries.view(id, actor), actor);
  }
}
