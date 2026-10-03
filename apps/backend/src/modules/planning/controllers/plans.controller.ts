import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { PlanRevisionDto, UnplannedOrderDto } from '../dto/plan-actions.dto';
import { PlanContextDto } from '../dto/plan-engine.dto';
import { PlanDayParamsDto, PlanDto, TripDto } from '../dto/plan.dto';
import { PlanQueries } from '../services/plan.queries';
import { PlansService } from '../services/plans.service';

/** Reading a day's plan (05, 09, 15, 17). Out of scope is 404 (AC-PLN-32). */
@ApiTags('plans')
@Controller()
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly queries: PlanQueries,
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

  @Get('plans/:id/revisions')
  @RequirePermission('plan:read')
  @ApiPaginated(PlanRevisionDto)
  @ApiProblems(404)
  revisions(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.queries.revisions(id, actor);
  }
}
