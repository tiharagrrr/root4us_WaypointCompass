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
  RequirePermission,
} from '../../../core/http/decorators';
import { OutletDto, UpdateOutletDto } from '../dto/outlet.dto';
import { OUTLET_RESOURCE } from '../outlet.resource';
import { OutletLinks } from '../policies/outlet.links';
import { OutletQueries } from '../services/outlet.queries';
import { OutletsService } from '../services/outlets.service';

/**
 * Outlets: A3's list and edit, and the row every other screen reads an
 * outlet's window, dock and access notes from. Times go out as minutes
 * beside a label (AC-MD-03).
 */
@ApiTags('outlets')
@Controller('outlets')
export class OutletsController {
  constructor(
    private readonly queries: OutletQueries,
    private readonly outlets: OutletsService,
    private readonly links: OutletLinks,
  ) {}

  @Get()
  @RequirePermission('masterData:read')
  @ApiPaginated(OutletDto, { resource: OUTLET_RESOURCE })
  @ApiOperation({ summary: 'List outlets' })
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
  @ApiResource(OutletDto)
  @ApiOperation({ summary: 'One outlet' })
  async get(@Param('id') id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.queries.get(id, actor), actor);
  }

  /** A3: windows, dock, parking, the receiving contact and D9's access notes. */
  @Patch(':id')
  @RequirePermission('masterData:manage')
  @ApiResource(OutletDto)
  @ApiProblems(400)
  @ApiOperation({ summary: 'Edit an outlet' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOutletDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.outlets.update(id, dto, actor), actor);
  }
}
