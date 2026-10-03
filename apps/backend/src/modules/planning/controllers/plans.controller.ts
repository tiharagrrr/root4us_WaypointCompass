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
import { notImplemented } from '../../../core/http/not-implemented';
import { PlanRevisionDto, UnplannedOrderDto } from '../dto/plan-actions.dto';
import { PlanContextDto } from '../dto/plan-engine.dto';
import { PlanDayParamsDto, PlanDto, TripDto } from '../dto/plan.dto';

/**
 * Reading a day's plan (05, 09, 15, 17). Contract first (ROO-29): the routes,
 * permissions and shapes are final, and the services land in the next PRs;
 * until then the web runs on the generated mocks.
 */
@ApiTags('plans')
@Controller()
export class PlansController {
  /** The plan, created as a DRAFT on first access (AC-PLN-08). */
  @Get('depots/:depotId/plans/:date')
  @RequirePermission('plan:read')
  @ApiResource(PlanDto)
  @ApiOperation({
    summary: "A depot's plan for a date, created on first access",
  })
  forDay(@Param() params: PlanDayParamsDto, @Actor() actor: SignedIn) {
    return notImplemented('GET /depots/{depotId}/plans/{date}', {
      params,
      actor,
    });
  }

  @Get('plans/:id')
  @RequirePermission('plan:read')
  @ApiResource(PlanDto)
  get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return notImplemented('GET /plans/{id}', { id, actor });
  }

  @Get('plans/:id/trips')
  @RequirePermission('plan:read')
  @ApiPaginated(TripDto)
  @ApiProblems(404)
  trips(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return notImplemented('GET /plans/{id}/trips', { id, actor });
  }

  /** Everything the engine needs, so the web validates edits instantly (AC-PLN-12). */
  @Get('plans/:id/context')
  @RequirePermission('plan:read')
  @ApiResource(PlanContextDto)
  context(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return notImplemented('GET /plans/{id}/context', { id, actor });
  }

  /** Orders on no trip, with reason, priority and repeat-skip flag (15). */
  @Get('plans/:id/unplanned')
  @RequirePermission('plan:read')
  @ApiPaginated(UnplannedOrderDto)
  @ApiProblems(404)
  unplanned(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return notImplemented('GET /plans/{id}/unplanned', { id, actor });
  }

  @Get('plans/:id/revisions')
  @RequirePermission('plan:read')
  @ApiPaginated(PlanRevisionDto)
  @ApiProblems(404)
  revisions(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return notImplemented('GET /plans/{id}/revisions', { id, actor });
  }
}
