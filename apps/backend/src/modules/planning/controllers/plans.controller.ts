import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { EndOfDayDto } from '../dto/end-of-day.dto';
import { PlanRevisionDto, UnplannedOrderDto } from '../dto/plan-actions.dto';
import { PlanContextDto } from '../dto/plan-engine.dto';
import { PlanDayParamsDto, PlanDto, TripDto } from '../dto/plan.dto';
import {
  OrderEtaDto,
  TrackingDayDto,
  TrackingQueryDto,
} from '../dto/tracking.dto';
import { DriverOptionDto } from '../dto/trip-ops.dto';
import { DayCloseService } from '../services/day-close.service';
import { TrackingQueries } from '../services/tracking.queries';
import { TripOperationsService } from '../services/trip-operations.service';
import { PlanQueries } from '../services/plan.queries';
import { PlansService } from '../services/plans.service';

/** Reading a day's plan (05, 09, 15, 17). Out of scope is 404 (AC-PLN-32). */
@ApiTags('plans')
@Controller()
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly queries: PlanQueries,
    private readonly dayClose: DayCloseService,
    private readonly tripOps: TripOperationsService,
    private readonly trackingQueries: TrackingQueries,
  ) {}

  /** The plan, created as a DRAFT on first access (AC-PLN-08). */
  @Get('depots/:depotId/plans/:date')
  @RequirePermission('plan:read')
  @ApiResource(PlanDto)
  @ApiOperation({
    summary: "A depot's plan for a date, created on first access",
  })
  async forDay(@Param() params: PlanDayParamsDto, @Actor() actor: SignedIn) {
    const plan = await this.plans.getOrCreate(
      params.depotId,
      params.date,
      actor,
    );
    return this.queries.view(await this.plans.contextFor(plan), actor);
  }

  /** 01, 19, 19a: the depot's day on the road, with projected arrivals and late risk (AC-PLN-39). */
  @Get('depots/:depotId/tracking')
  @RequirePermission('plan:read')
  @ApiResource(TrackingDayDto)
  @ApiProblems(404)
  tracking(
    @Param('depotId') depotId: string,
    @Query() query: TrackingQueryDto,
    @Actor() actor: SignedIn,
  ) {
    return this.trackingQueries.day(depotId, query.date, actor);
  }

  /** M3: the store's ETA for an order, never the map (AC-EXE-22). */
  @Get('orders/:id/eta')
  @RequirePermission('tracking:read')
  @ApiResource(OrderEtaDto)
  @ApiOperation({
    summary: "An order's ETA",
    description:
      'When the delivery is expected: the planned arrival, or the projection from now once the trip is on the road. Carries no vehicle position.',
  })
  orderEta(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.trackingQueries.orderEta(id, actor);
  }

  @Get('plans/:id')
  @RequirePermission('plan:read')
  @ApiResource(PlanDto)
  get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.queries.get(id, actor);
  }

  @Get('plans/:id/trips')
  @RequirePermission('plan:read')
  @ApiPaginated(TripDto)
  @ApiProblems(404)
  trips(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.queries.trips(id, actor);
  }

  /** Everything the engine needs, so the web validates edits instantly (AC-PLN-12). */
  @Get('plans/:id/context')
  @RequirePermission('plan:read')
  @ApiResource(PlanContextDto)
  context(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.queries.context(id, actor);
  }

  /** Orders on no trip, with reason, priority and repeat-skip flag (15). */
  @Get('plans/:id/unplanned')
  @RequirePermission('plan:read')
  @ApiPaginated(UnplannedOrderDto)
  @ApiProblems(404)
  unplanned(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.queries.unplanned(id, actor);
  }

  /** 21: each trip's results, what to follow up, and whether the day can close. */
  @Get('plans/:id/end-of-day')
  @RequirePermission('plan:read')
  @ApiResource(EndOfDayDto)
  @ApiProblems(404)
  endOfDay(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.dayClose.endOfDay(id, actor);
  }

  /** 20: the depot's drivers and their trips on this plan (AC-PLN-37). */
  @Get('plans/:id/driver-options')
  @RequirePermission('plan:read')
  @ApiPaginated(DriverOptionDto)
  @ApiProblems(404)
  async driverOptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    const items = await this.tripOps.driverOptions(id, actor);
    return {
      items,
      page: { limit: items.length, offset: 0, total: items.length },
      links: { self: { href: `/api/v1/plans/${id}/driver-options` } },
    };
  }

  @Get('plans/:id/revisions')
  @RequirePermission('plan:read')
  @ApiPaginated(PlanRevisionDto)
  @ApiProblems(404)
  revisions(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.queries.revisions(id, actor);
  }
}
