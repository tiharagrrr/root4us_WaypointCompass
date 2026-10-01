import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { AdminDeviceDto, DockDeviceDto } from '../dto/device.dto';
import { DeviceLinks } from '../policies/device.links';
import { DEVICES, DeviceQueries } from '../services/device.queries';
import { DockService } from '../services/dock.service';

/** A6 dock tablets. Devices register themselves through POST /me/devices. */
@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly queries: DeviceQueries,
    private readonly dock: DockService,
    private readonly links: DeviceLinks,
  ) {}

  @Get()
  @RequirePermission('settings:manage')
  @ApiPaginated(AdminDeviceDto, { resource: DEVICES })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: Actor,
    @Req() req: Request,
  ) {
    return this.links.page(await this.queries.list(query, actor), actor, req);
  }

  @Get(':id')
  @RequirePermission('settings:manage')
  @ApiResource(AdminDeviceDto)
  async get(@Param('id') id: string, @Actor() actor: Actor) {
    return this.links.one(await this.queries.get(id, actor), actor);
  }

  /** Marks a registered tablet as a depot's dock device (AC-IDN-27). */
  @Put(':id/dock')
  @RequirePermission('settings:manage')
  @ApiResource(AdminDeviceDto)
  @ApiProblems(409)
  async setDock(
    @Param('id') id: string,
    @Body() dto: DockDeviceDto,
    @Actor() actor: Actor,
  ) {
    return this.links.one(await this.dock.dock(id, dto.depotId, actor), actor);
  }

  @Delete(':id/dock')
  @RequirePermission('settings:manage')
  @ApiResource(AdminDeviceDto)
  @ApiProblems(409)
  async clearDock(@Param('id') id: string, @Actor() actor: Actor) {
    return this.links.one(await this.dock.undock(id, actor), actor);
  }
}
