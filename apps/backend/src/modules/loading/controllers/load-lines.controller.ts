import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { UndoCheckDto } from '../dto/load-check.dto';
import { LoadLineDto } from '../dto/load-list.dto';
import { LoadListLinks } from '../policies/load-list.links';
import { LoadCheckService } from '../services/load-check.service';
import { LoadingQueries } from '../services/loading.queries';

/**
 * One line of a load list: what it says, and taking back the check on it
 * (AC-LOD-06). Checks themselves go to the trip's batch endpoint, because a
 * loader taps several rows before the tablet gets a moment to send them.
 */
@ApiTags('loading')
@Controller('load-lines')
export class LoadLinesController {
  constructor(
    private readonly queries: LoadingQueries,
    private readonly checks: LoadCheckService,
    private readonly links: LoadListLinks,
  ) {}

  @Get(':id')
  @RequirePermission('load:read')
  @ApiResource(LoadLineDto)
  @ApiProblems(404)
  @ApiOperation({ summary: 'One line of a load list' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    const line = await this.queries.line(id, actor);
    return this.links.line(
      line,
      await this.queries.trip(line.tripId, actor),
      actor,
    );
  }

  /**
   * The loader miscounted, or took the pallet back off. Allowed until the
   * trip is released; after that the list is closed and this is a 409
   * (AC-LOD-06).
   */
  @Post(':id/undo')
  @HttpCode(200)
  @RequirePermission('load:check')
  @ApiResource(LoadLineDto)
  @ApiProblems(404, 409)
  @ApiOperation({ summary: 'Undo the check on a line' })
  async undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UndoCheckDto,
    @Actor() actor: SignedIn,
  ) {
    const line = await this.checks.undo(id, actor, {
      checkedByName: dto.checkedByName ?? null,
    });
    const after = await this.queries.line(line.id, actor);
    return this.links.line(
      after,
      await this.queries.trip(after.tripId, actor),
      actor,
    );
  }
}
