import { Body, Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  Actor,
  AnyRole,
  ApiPaginated,
  ApiResource,
} from '../../../core/http/decorators';
import { DeviceDto, RegisterDeviceDto } from '../dto/device.dto';
import { MeDto, UpdateMeDto } from '../dto/me.dto';
import { MeLinks } from '../policies/me.links';
import { DevicesService } from '../services/devices.service';
import { MeService } from '../services/me.service';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly devices: DevicesService,
    private readonly links: MeLinks,
  ) {}

  /** Profile, role, scope and permission list (D12). */
  @Get()
  @AnyRole()
  @ApiResource(MeDto)
  async get(@Actor() actor: Actor) {
    return this.links.me(await this.me.get(actor));
  }

  /** The caller's own settings; role and scope are refused with 400. */
  @Patch()
  @AnyRole()
  @ApiResource(MeDto)
  async update(@Body() dto: UpdateMeDto, @Actor() actor: Actor) {
    return this.links.me(await this.me.update(actor, dto));
  }

  @Get('devices')
  @AnyRole()
  @ApiPaginated(DeviceDto)
  async listDevices(@Actor() actor: Actor) {
    return this.links.devices(await this.devices.list(actor));
  }

  /** 201 for a new device, 200 when it registers again. */
  @Post('devices')
  @AnyRole()
  @ApiResource(DeviceDto, { status: 201 })
  async registerDevice(
    @Body() dto: RegisterDeviceDto,
    @Actor() actor: Actor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { device, created } = await this.devices.register(
      actor,
      dto,
      req.header('user-agent'),
    );
    res.status(created ? 201 : 200);
    if (created) res.location(`/api/v1/me/devices/${device.id}`);
    return this.links.device(device);
  }
}
