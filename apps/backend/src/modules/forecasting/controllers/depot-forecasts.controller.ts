import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { DepotForecastDto, ForecastQueryDto } from '../dto/forecast.dto';
import { ForecastQueries } from '../services/forecast.queries';

const DEFAULT_WEEKS = 10;

/** The weeks ahead against fleet capacity (22; 12 reads it too). */
@ApiTags('forecasts')
@Controller('depots')
export class DepotForecastsController {
  constructor(
    private readonly forecasts: ForecastQueries,
    private readonly clock: ClockService,
  ) {}

  @Get(':id/forecasts')
  @RequirePermission('forecast:read')
  @ApiResource(DepotForecastDto)
  @ApiProblems(400, 404)
  @ApiOperation({
    summary: 'A depot’s forecast volume by week against fleet capacity',
  })
  async list(
    @Param('id') id: string,
    @Query() query: ForecastQueryDto,
    @Actor() actor: SignedIn,
  ): Promise<DepotForecastDto> {
    const count = query.weeks ?? DEFAULT_WEEKS;
    const forecast = await this.forecasts.weeksAhead(
      id,
      this.clock.businessDate(),
      count,
      actor,
      query.brand,
    );
    const brand = query.brand ? `&brand=${query.brand}` : '';
    return {
      ...forecast,
      brand: query.brand ?? null,
      gapWeeks: forecast.weeks.filter((w) => w.overCapacity).length,
      _links: {
        self: { href: `/api/v1/depots/${id}/forecasts?weeks=${count}${brand}` },
      },
    };
  }
}
