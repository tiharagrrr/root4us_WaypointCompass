import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { DecideFlagDto, RecheckFlagDto } from '../dto/load-flag.dto';
import { LoadFlagDto } from '../dto/load-list.dto';
import { LOAD_FLAG_RESOURCE } from '../load-flag.resource';
import { LoadFlagLinks } from '../policies/load-flag.links';
import { LoadFlagService } from '../services/load-flag.service';
import { LoadingQueries } from '../services/loading.queries';

/**
 * The dispatcher's flag queue and the three things that close a flag: the
 * raiser's undo (L3a), the dispatcher's decision (L3b) and the loader's
 * re-check (L3c). The flag panels on 01 and 19 read the list;
 * AC-LOD-07 to AC-LOD-12.
 *
 * None of the writes takes `If-Match`: a flag carries no version, and the
 * flag machine is what makes a second decision a 409 rather than a silent
 * overwrite (AC-LOD-10).
 */
@ApiTags('loading')
@Controller('load-flags')
export class LoadFlagsController {
  constructor(
    private readonly queries: LoadingQueries,
    private readonly flags: LoadFlagService,
    private readonly links: LoadFlagLinks,
  ) {}

  /** The queue on 01 and 19: open first, then awaiting a re-check. */
  @Get()
  @RequirePermission('load:read')
  @ApiPaginated(LoadFlagDto, { resource: LOAD_FLAG_RESOURCE })
  @ApiOperation({ summary: "The depot's load flags, unanswered first" })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    return this.links.page(await this.queries.list(query, actor), actor, req);
  }

  @Get(':id')
  @RequirePermission('load:read')
  @ApiResource(LoadFlagDto)
  @ApiProblems(404)
  @ApiOperation({ summary: 'One flag, with what can be done about it' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.queries.flag(id, actor), actor);
  }

  /** L3a: the loader found the crate after all, and nobody has answered yet. */
  @Post(':id/undo')
  @HttpCode(200)
  @RequirePermission('load:flag')
  @ApiResource(LoadFlagDto)
  @ApiProblems(403, 404, 409)
  @ApiOperation({ summary: 'Undo the flag before it is decided' })
  async undo(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.flags.undo(id, actor), actor);
  }

  /** L3b: REPLACE sends the loader back; REMOVE defers part of the order. */
  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermission('load:decide')
  @ApiResource(LoadFlagDto)
  @ApiProblems(400, 404, 409)
  @ApiOperation({ summary: 'Decide the flag: replace or remove' })
  async decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideFlagDto,
    @Actor() actor: SignedIn,
  ) {
    const { flag } = await this.flags.decide(
      id,
      {
        decision: dto.decision,
        reasonCode: dto.reasonCode ?? null,
        note: dto.note ?? null,
      },
      actor,
    );
    return this.links.one(flag, actor);
  }

  /** L3c: the replacement is on the vehicle, so the flag closes. */
  @Post(':id/recheck')
  @HttpCode(200)
  @RequirePermission('load:check')
  @ApiResource(LoadFlagDto)
  @ApiProblems(400, 404, 409)
  @ApiOperation({ summary: 'Re-check the item after a replacement' })
  async recheck(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecheckFlagDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(
      await this.flags.recheck(
        id,
        {
          qtyLoaded: dto.qtyLoaded,
          checkedByName: dto.checkedByName,
          clientUuid: dto.clientUuid,
        },
        actor,
      ),
      actor,
    );
  }
}
