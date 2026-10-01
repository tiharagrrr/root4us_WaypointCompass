import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  Actor,
  AnyRole,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { ClockDto, SetClockDto } from '../dto/settings.dto';
import { SettingLinks } from '../policies/setting.links';
import { DemoCommands } from '../services/demo.commands';

/** The demo clock: everyone reads it (the header badge), the admin sets it on A6. */
@ApiTags('clock')
@Controller('clock')
export class ClockController {
  constructor(
    private readonly demo: DemoCommands,
    private readonly links: SettingLinks,
  ) {}

  @Get()
  @AnyRole()
  @ApiResource(ClockDto)
  get(@Actor() actor: Actor) {
    return this.links.clockView(actor);
  }

  /** Time travel; 404 unless DEMO_MODE=true. */
  @Put()
  @RequirePermission('settings:manage')
  @ApiResource(ClockDto)
  async set(@Body() dto: SetClockDto, @Actor() actor: Actor) {
    await this.demo.setClock(dto, actor);
    return this.links.clockView(actor);
  }
}
