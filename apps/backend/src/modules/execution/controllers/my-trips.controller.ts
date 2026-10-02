import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Request } from 'express';
import {
  Actor,
  ApiPaginated,
  RequirePermission,
} from '../../../core/http/decorators';
import { TripDateQueryDto, TripSummaryDto } from '../dto/trip.dto';
import { TripLinks } from '../policies/trip.links';
import { MyTripsQueries } from '../services/my-trips.queries';

/**
 * The driver's own trips: D1 for today, D10 for the last 7 days and D14 when
 * there is nothing. The actor's id is the filter, so there is no driver
 * parameter to get wrong (AC-EXE-01, AC-EXE-02).
 */
@ApiTags('execution')
@Controller('me/trips')
export class MyTripsController {
  constructor(
    private readonly queries: MyTripsQueries,
    private readonly links: TripLinks,
  ) {}

  @Get()
  @RequirePermission('trip:read')
  @ApiPaginated(TripSummaryDto)
  @ApiOperation({
    summary: 'My trips',
    description:
      'One business date with ?date=, or the last 7 days without it. An empty list is what D14 shows.',
  })
  async list(
    @Query() query: TripDateQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    const trips = await this.queries.list(actor, query.date);
    return this.links.page(
      {
        items: trips,
        page: { limit: trips.length, offset: 0, total: trips.length },
      },
      actor,
      req,
    );
  }
}
