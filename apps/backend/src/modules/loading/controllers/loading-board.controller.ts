import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import {
  DockLoadersDto,
  LoadLineDto,
  LoadProgressDto,
  LoadRunDto,
  LoadTripSummaryDto,
} from '../dto/load-list.dto';
import { LoadingBoardQueryDto } from '../dto/release.dto';
import { LoadListLinks } from '../policies/load-list.links';
import { LoadingQueries } from '../services/loading.queries';

/**
 * The dock's two boards (L2m-a Runs and L2's trip list). Both are one depot's
 * day: the scope decides which depots a caller may ask about, and a loader's
 * window is today and tomorrow, so yesterday's board answers with nothing
 * rather than with yesterday (AC-LOD-02).
 *
 * `date` defaults to today on the demo clock, so a tablet that reads the
 * board on waking does not have to know what day it is.
 */
@ApiTags('loading')
// Both boards answer with a bare array in `data`, which `ApiResource` and
// `ApiPaginated` do not describe, so the schemas are declared by hand — and
// a hand-written `$ref` needs its models registered here or openapi.json
// comes out with a dangling reference.
@ApiExtraModels(LoadRunDto, LoadTripSummaryDto, LoadProgressDto, LoadLineDto)
@Controller('depots/:depotId/loading')
export class LoadingBoardController {
  constructor(
    private readonly queries: LoadingQueries,
    private readonly links: LoadListLinks,
  ) {}

  /** L2m-a: the day's trips by wave, with progress and open flags. */
  @Get('runs')
  @RequirePermission('load:read')
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(LoadRunDto) } },
      },
    },
  })
  @ApiProblems(400, 401, 403)
  @ApiOperation({ summary: "The dock's runs for a day, by wave" })
  async runs(
    @Param('depotId') depotId: string,
    @Query() query: LoadingBoardQueryDto,
    @Actor() actor: SignedIn,
  ) {
    const date = query.date ?? this.queries.today();
    return this.links.runs(
      await this.queries.runs(depotId, date, actor),
      actor,
    );
  }

  /** L2: the trips of one wave, or of the whole day when no wave is given. */
  @Get('trips')
  @RequirePermission('load:read')
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(LoadTripSummaryDto) },
        },
      },
    },
  })
  @ApiProblems(400, 401, 403)
  @ApiOperation({ summary: "A wave's trips to load" })
  async trips(
    @Param('depotId') depotId: string,
    @Query() query: LoadingBoardQueryDto,
    @Actor() actor: SignedIn,
  ) {
    const date = query.date ?? this.queries.today();
    const trips = await this.queries.trips(depotId, date, actor, query.wave);
    return trips.map((trip) => this.links.summary(trip, actor));
  }

  /** L2's Checked by: the depot's loader roster from A6, for a shared tablet. */
  @Get('loaders')
  @RequirePermission('load:read')
  @ApiResource(DockLoadersDto)
  @ApiProblems(401, 403, 404)
  @ApiOperation({ summary: "The depot's dock loader names" })
  async loaders(
    @Param('depotId') depotId: string,
    @Actor() actor: SignedIn,
  ): Promise<DockLoadersDto> {
    return {
      depotId,
      names: await this.queries.loaders(depotId, actor),
      _links: {
        self: { href: `/api/v1/depots/${depotId}/loading/loaders` },
      },
    };
  }
}
