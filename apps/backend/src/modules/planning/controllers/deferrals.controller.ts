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
import { ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Request } from 'express';
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import { DEFERRAL_RESOURCE } from '../deferral.resource';
import {
  DeferralDto,
  DeferralResponseDto,
  ReplyDeferralDto,
  ReverseDeferralDto,
} from '../dto/deferral.dto';
import { DeferralLinks } from '../policies/deferral.links';
import { DeferralActions } from '../services/deferral-actions.service';
import { DeferralQueries } from '../services/deferral.queries';

/**
 * Deferrals for the dispatcher (23) and the store (M4, M7). A store manager
 * sees only their outlet's deferrals, and only once their plan is published
 * (DeferralScope).
 */
@ApiTags('deferrals')
@Controller('deferrals')
export class DeferralsController {
  constructor(
    private readonly queries: DeferralQueries,
    private readonly actions: DeferralActions,
    private readonly links: DeferralLinks,
  ) {}

  /** Offset pages, newest first, e.g. `?filter[storeResponse]=AWAITING&limit=10`. */
  @Get()
  @RequirePermission('deferral:read')
  @ApiPaginated(DeferralDto, { resource: DEFERRAL_RESOURCE })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    return this.links.page(await this.queries.list(query, actor), actor, req);
  }

  @Get(':id')
  @RequirePermission('deferral:read')
  @ApiResource(DeferralDto)
  @ApiProblems(404)
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.queries.get(id, actor), actor);
  }

  /** M4: acknowledge, or request priority with a note (AC-PLN-27). */
  @Post(':id/response')
  @HttpCode(200)
  @RequirePermission('deferral:respond')
  @UseIdempotency()
  @ApiResource(DeferralDto)
  @ApiProblems(404, 409)
  async respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeferralResponseDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.actions.respond(id, dto, actor), actor);
  }

  /** 19c: keep a delivery the device recorded for a deferred stop (AC-PLN-28). */
  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermission('deferral:decide')
  @UseIdempotency()
  @ApiResource(DeferralDto)
  @ApiProblems(404, 409)
  async reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseDeferralDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.actions.reverse(id, dto, actor), actor);
  }

  /** 23: the dispatcher's one reply to the store, shown on M4 (AC-PLN-35). */
  @Post(':id/reply')
  @HttpCode(200)
  @RequirePermission('deferral:decide')
  @UseIdempotency()
  @ApiResource(DeferralDto)
  @ApiProblems(404, 409)
  async reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyDeferralDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.actions.reply(id, dto, actor), actor);
  }
}
