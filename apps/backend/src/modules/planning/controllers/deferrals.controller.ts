import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import { notImplemented } from '../../../core/http/not-implemented';
import {
  DeferralDto,
  DeferralResponseDto,
  ReverseDeferralDto,
} from '../dto/deferral.dto';

/**
 * Deferrals for the dispatcher (23) and the store (M4, M7). A store manager
 * sees only her outlet's deferrals, and only once their plan is published.
 * Contract first (ROO-29).
 */
@ApiTags('deferrals')
@Controller('deferrals')
export class DeferralsController {
  /** Offset pages, e.g. `?filter[outletId]=…&sort=-createdAt&limit=10`. */
  @Get()
  @RequirePermission('deferral:read')
  @ApiPaginated(DeferralDto)
  list(@Query() query: ListQueryDto, @Actor() actor: SignedIn) {
    return notImplemented('GET /deferrals', { query, actor });
  }

  @Get(':id')
  @RequirePermission('deferral:read')
  @ApiResource(DeferralDto)
  get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return notImplemented('GET /deferrals/{id}', { id, actor });
  }

  /** M4: acknowledge, or request priority with a note (AC-PLN-27). */
  @Post(':id/response')
  @HttpCode(200)
  @RequirePermission('deferral:respond')
  @UseIdempotency()
  @ApiResource(DeferralDto)
  @ApiProblems(409)
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeferralResponseDto,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('POST /deferrals/{id}/response', { id, dto, actor });
  }

  /** 19c: keep a delivery the device recorded for a deferred stop (AC-PLN-28). */
  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermission('deferral:decide')
  @UseIdempotency()
  @ApiResource(DeferralDto)
  @ApiProblems(409)
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseDeferralDto,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('POST /deferrals/{id}/reverse', { id, dto, actor });
  }
}
