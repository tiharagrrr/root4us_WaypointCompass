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
import {
  DeferStopDto,
  ReassignTripDto,
  ResequencePreviewDto,
  ResequencePreviewRequestDto,
  ResequenceTripDto,
} from '../dto/trip-ops.dto';
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

  /** 19b: projected arrivals and violations for an order of the stops; saves nothing (AC-PLN-38). */
  @Post(':id/resequence/preview')
  @HttpCode(200)
  @RequirePermission('trip:resequence')
  @ApiResource(ResequencePreviewDto)
  @ApiProblems(404, 409)
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResequencePreviewRequestDto,
    @Actor() actor: SignedIn,
  ) {
    return this.operations.previewResequence(id, dto.stopIds, actor);
  }

  /** 19a, 19b: one stop still to come is deferred to the next run (AC-PLN-25). */
  @Post(':id/stops/:stopId/defer')
  @HttpCode(200)
  @RequirePermission('deferral:decide')
  @UseIdempotency()
  @ApiResource(TripDto)
  @ApiProblems(404, 409, 412, 428)
  async deferStop(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body() dto: DeferStopDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    const trip = await this.operations.deferStop(
      id,
      stopId,
      version,
      dto,
      actor,
    );
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
