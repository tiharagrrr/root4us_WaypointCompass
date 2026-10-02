import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Response } from 'express';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { NotFoundError } from '../../../core/errors/domain-errors';
import { SettingsService } from '../../../core/settings/settings.service';
import { LoadCheckBatchDto } from '../dto/load-check.dto';
import { RaiseFlagDto } from '../dto/load-flag.dto';
import {
  LoadFlagDto,
  LoadLineDto,
  LoadListDto,
  ReleaseChecksDto,
} from '../dto/load-list.dto';
import { BatchResultsDto } from '../dto/batch.dto';
import { ReleaseChecksQueryDto, ReleaseTripDto } from '../dto/release.dto';
import { LoadFlagLinks } from '../policies/load-flag.links';
import { LoadListLinks } from '../policies/load-list.links';
import { LoadCheckService } from '../services/load-check.service';
import { LoadFlagService } from '../services/load-flag.service';
import { LoadingQueries } from '../services/loading.queries';
import { ReleaseService } from '../services/release.service';

/**
 * One trip's loading: the checklist, the checks against it, the flags raised
 * on it, and the release that lets it leave (L2, L3, L4).
 *
 * None of these writes takes `If-Match`. Load lines and flags carry no
 * version: a loader's tablet works offline, so the thing that makes a write
 * safe to repeat is the `clientUuid` it was made with, not a version it read
 * (specs/api-conventions.md, section 5).
 */
@ApiTags('loading')
@ApiExtraModels(LoadLineDto, LoadFlagDto)
@Controller()
export class TripLoadingController {
  constructor(
    private readonly queries: LoadingQueries,
    private readonly checks: LoadCheckService,
    private readonly flags: LoadFlagService,
    private readonly release: ReleaseService,
    private readonly links: LoadListLinks,
    private readonly flagLinks: LoadFlagLinks,
    private readonly settings: SettingsService,
  ) {}

  /** L2: the checklist, last stop first. */
  @Get('trips/:id/load-list')
  @RequirePermission('load:read')
  @ApiResource(LoadListDto)
  @ApiProblems(404)
  @ApiOperation({ summary: "A trip's load list, last stop first" })
  async loadList(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    const { list, checks } = await this.queries.releaseChecksFor(id, actor);
    return this.links.list(list, actor, checks);
  }

  /**
   * L2: a batch of checks. 200 with a result per item, even when some were
   * refused: a batch never fails as a whole over one bad crate
   * (specs/api-conventions.md, section 3). The same body arrives through
   * `POST /sync` when the dock's wifi comes back.
   */
  @Post('trips/:id/load-list/checks')
  @HttpCode(200)
  @RequirePermission('load:check')
  @ApiExtraModels(BatchResultsDto)
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['data', 'meta'],
      properties: { data: { $ref: getSchemaPath(BatchResultsDto) } },
    },
  })
  @ApiProblems(400, 401, 403, 404)
  @ApiOperation({ summary: 'Check lines off the list' })
  async check(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoadCheckBatchDto,
    @Actor() actor: SignedIn,
  ): Promise<BatchResultsDto> {
    const { results } = await this.checks.checkMany(
      id,
      dto.checks.map((item) => ({
        lineId: item.lineId,
        qtyLoaded: item.qtyLoaded,
        checkedByName: item.checkedByName,
        clientUuid: item.clientUuid,
        checkedAt: new Date(item.checkedAt),
        deviceSeq: item.deviceSeq ?? null,
        deviceId: item.deviceId ?? null,
      })),
      actor,
    );
    const { list, checks } = await this.queries.releaseChecksFor(id, actor);
    return {
      results,
      applied: results.filter((r) => r.status === 'applied').length,
      list: this.links.list(list, actor, checks),
    };
  }

  /** L3: something is wrong with these goods. */
  @Post('trips/:id/load-flags')
  @RequirePermission('load:flag')
  @ApiResource(LoadFlagDto, { status: 201 })
  @ApiProblems(400, 404, 409)
  @ApiOperation({ summary: 'Flag an item on the list' })
  async raise(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RaiseFlagDto,
    @Actor() actor: SignedIn,
    @Res({ passthrough: true }) res: Response,
  ) {
    // The trip in the path is the one the line has to be on. Reading both
    // through the scope makes another depot's trip a 404 before anything is
    // written, and a line reached through the wrong trip's id is not that
    // trip's business either.
    const trip = await this.queries.trip(id, actor);
    const line = await this.queries.line(dto.loadLineId, actor);
    if (line.tripId !== trip.id) throw new NotFoundError('load line');

    const { flag } = await this.flags.raise(
      {
        loadLineId: dto.loadLineId,
        reason: dto.reason,
        qtyAffected: dto.qtyAffected,
        note: dto.note ?? null,
        raisedByName: dto.raisedByName,
        clientUuid: dto.clientUuid,
      },
      actor,
    );
    res.location(`/api/v1/load-flags/${flag.id}`);
    return this.flagLinks.one(flag, actor);
  }

  /** L4: each precondition with a pass or a fail. */
  @Get('trips/:id/release-checks')
  @RequirePermission('load:read')
  @ApiResource(ReleaseChecksDto)
  @ApiProblems(404)
  @ApiOperation({ summary: "A trip's release preconditions" })
  async releaseChecks(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ReleaseChecksQueryDto,
    @Actor() actor: SignedIn,
  ) {
    const { list, checks } = await this.queries.releaseChecksFor(id, actor, {
      reeferTempC: query.reeferTempC ?? null,
    });
    return this.links.checks(
      list,
      actor,
      checks,
      await this.settings.get('loading.maxReleaseTempC'),
    );
  }

  /**
   * L4: the trip leaves. 409 with the failing checks while anything is
   * outstanding (AC-LOD-14, AC-LOD-15); the same `clientUuid` twice is one
   * release, not two (AC-LOD-16).
   */
  @Post('trips/:id/release')
  @HttpCode(200)
  @RequirePermission('load:release')
  @ApiResource(LoadListDto)
  @ApiProblems(400, 404, 409)
  @ApiOperation({ summary: 'Release the trip (online only)' })
  async releaseTrip(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReleaseTripDto,
    @Actor() actor: SignedIn,
  ) {
    const released = await this.release.release(
      id,
      {
        reeferTempC: dto.reeferTempC ?? null,
        checkedByName: dto.checkedByName,
        clientUuid: dto.clientUuid,
        planRevision: dto.planRevision ?? null,
      },
      actor,
    );
    return this.links.list(released.list, actor, released.checks);
  }
}
