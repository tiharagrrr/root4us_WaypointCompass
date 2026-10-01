import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ValidationError } from '../../../core/errors/domain-errors';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { SettingsService } from '../../../core/settings/settings.service';
import {
  SetSettingDto,
  SettingDto,
  SettingScopeQueryDto,
} from '../dto/settings.dto';
import { SettingLinks } from '../policies/setting.links';
import { SettingsCommands } from '../services/settings.commands';

/** A6 settings. A depot override is addressed with ?depotId=. */
@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly commands: SettingsCommands,
    private readonly links: SettingLinks,
  ) {}

  /** Every registered key, resolved: depot override, global, then default. */
  @Get()
  @RequirePermission('settings:read')
  @ApiPaginated(SettingDto)
  async list(@Query() q: SettingScopeQueryDto, @Actor() actor: Actor) {
    const depotId = q.depotId ?? null;
    return this.links.list(await this.settings.list(depotId), actor, depotId);
  }

  @Get(':key')
  @RequirePermission('settings:read')
  @ApiResource(SettingDto)
  async get(
    @Param('key') key: string,
    @Query() q: SettingScopeQueryDto,
    @Actor() actor: Actor,
  ) {
    return this.links.one(await this.settings.resolve(key, q.depotId), actor);
  }

  /** 400 when the value fails the key's schema; audited and broadcast. */
  @Put(':key')
  @RequirePermission('settings:manage')
  @ApiResource(SettingDto)
  @ApiProblems(409)
  async set(
    @Param('key') key: string,
    @Query() q: SettingScopeQueryDto,
    @Body() dto: SetSettingDto,
    @Actor() actor: Actor,
  ) {
    const setting = await this.commands.set(
      key,
      dto.value,
      q.depotId ?? null,
      actor,
    );
    return this.links.one(setting, actor);
  }

  /** Removes a depot's override (?depotId= is required). */
  @Delete(':key')
  @RequirePermission('settings:manage')
  @ApiResource(SettingDto)
  async clearOverride(
    @Param('key') key: string,
    @Query() q: SettingScopeQueryDto,
    @Actor() actor: Actor,
  ) {
    if (!q.depotId)
      throw new ValidationError([
        {
          field: 'depotId',
          code: 'required',
          message: 'Name the depot whose override to remove',
        },
      ]);
    return this.links.one(
      await this.commands.clearOverride(key, q.depotId),
      actor,
    );
  }
}
