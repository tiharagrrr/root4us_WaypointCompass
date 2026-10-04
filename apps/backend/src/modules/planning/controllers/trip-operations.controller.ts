import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiProblems,
  ApiResource,
  IfMatch,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import { TripDto } from '../dto/plan.dto';
import { ReassignTripDto, ResequenceTripDto } from '../dto/trip-ops.dto';
import { PlanQueries } from '../services/plan.queries';
import { TripOperationsService } from '../services/trip-operations.service';

/**
 * 19b and 20: changes to one trip of a published plan, each with a reason
 * and the trip's If-Match. The engine validates first: a broken rule is 422
 * with the violations, and nothing is written.
 */
@ApiTags('trips')
@Controller('trips')
export class TripOperationsController {
  constructor(
    private readonly operations: TripOperationsService,
    private readonly queries: PlanQueries,
  ) {}

  /** 20: another vehicle or driver (AC-PLN-23). */
  @Post(':id/reassign')
  @HttpCode(200)
  @RequirePermission('trip:reassign')
  @UseIdempotency()
  @ApiResource(TripDto)
  @ApiProblems(404, 409, 412, 422, 428)
  async reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignTripDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    const trip = await this.operations.reassign(id, version, dto, actor);
    return this.queries.trip(trip.planId, trip.id, actor);
  }

  /** 19b: the stops still to come, in a new order (AC-PLN-24). */
  @Post(':id/resequence')
  @HttpCode(200)
  @RequirePermission('trip:resequence')
  @UseIdempotency()
  @ApiResource(TripDto)
  @ApiProblems(404, 409, 412, 422, 428)
  async resequence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResequenceTripDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    const trip = await this.operations.resequence(id, version, dto, actor);
    return this.queries.trip(trip.planId, trip.id, actor);
  }
}
