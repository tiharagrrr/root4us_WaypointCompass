import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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
import {
  ScopeOptionsDto,
  SetPinDto,
  UpdateUserDto,
  UserDto,
} from '../dto/user.dto';
import { UserLinks } from '../policies/user.links';
import { ScopeDirectory } from '../services/scope-directory';
import { USERS, UserQueries, type UserRow } from '../services/user.queries';
import { UsersService } from '../services/users.service';

/** A1 Users. Users are never deleted: deactivate keeps the row. */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly queries: UserQueries,
    private readonly users: UsersService,
    private readonly links: UserLinks,
    private readonly directory: ScopeDirectory,
  ) {}

  @Get()
  @RequirePermission('user:list')
  @ApiPaginated(UserDto, { resource: USERS })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: Actor,
    @Req() req: Request,
  ) {
    return this.links.page(await this.queries.list(query, actor), actor, req);
  }

  /** Depots, outlets and vehicles a user can be linked to (A1 edit, A2 "Link to"). */
  @Get('scope-options')
  @RequirePermission('user:list')
  @ApiResource(ScopeOptionsDto)
  scopeOptions() {
    return this.directory.options();
  }

  @Get(':id')
  @RequirePermission('user:list')
  @ApiResource(UserDto)
  async get(@Param('id') id: string, @Actor() actor: Actor) {
    return this.links.one(await this.queries.get(id, actor), actor);
  }

  /** Role or scope change with a reasonCode; signs the user out everywhere. */
  @Patch(':id')
  @RequirePermission('user:set-role')
  @ApiResource(UserDto)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Actor() actor: Actor,
  ) {
    return this.present(await this.users.update(id, dto, actor), actor);
  }

  /** 409 with a reassign link while a driver has a trip today. */
  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('user:ban')
  @ApiResource(UserDto)
  @ApiProblems(409)
  async deactivate(@Param('id') id: string, @Actor() actor: Actor) {
    return this.present(await this.users.deactivate(id, actor), actor);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('user:ban')
  @ApiResource(UserDto)
  @ApiProblems(409)
  async reactivate(@Param('id') id: string, @Actor() actor: Actor) {
    return this.present(await this.users.reactivate(id, actor), actor);
  }

  /** A loader's dock PIN; 409 when another loader of the depot holds it. */
  @Put(':id/pin')
  @RequirePermission('user:set-password')
  @ApiResource(UserDto)
  @ApiProblems(409)
  async setPin(
    @Param('id') id: string,
    @Body() dto: SetPinDto,
    @Actor() actor: Actor,
  ) {
    return this.present(await this.users.setPin(id, dto.pin, actor), actor);
  }

  /** A command's user, with the names A1 shows. */
  private async present(row: UserRow, actor: Actor) {
    const [named] = await this.queries.named([row]);
    return this.links.one(named, actor);
  }
}
