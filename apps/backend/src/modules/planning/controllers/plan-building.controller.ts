import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiExtraModels, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  IfMatch,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import { notImplemented } from '../../../core/http/not-implemented';
import { EDIT_OP_MODELS } from '../dto/edit-op.dto';
import {
  DeferralDecisionsDto,
  EditPlanDto,
  EngineRunDto,
  PublishPreviewDto,
  StartEngineRunDto,
} from '../dto/plan-actions.dto';
import {
  FixDto,
  OrderOptionDto,
  OrderOptionsQueryDto,
  SuggestFixesDto,
  ValidatePlanDto,
  ValidationResultDto,
  PlanVehicleOptionDto,
} from '../dto/plan-engine.dto';
import { PlanDto } from '../dto/plan.dto';

/**
 * Building and publishing a plan: Auto-suggest, the 06 to 08 wizard, edits,
 * fixes, deferral decisions and publish (05 to 18). Contract first (ROO-29).
 *
 * Plan writes carry `If-Match` with the plan's version and an
 * `Idempotency-Key` (specs/api-conventions.md, section 5). A broken hard rule
 * is 422 PLAN_RULE_VIOLATION with the violations and a `fixes` link; a soft
 * one without an override note is the same 422 listing the soft violations.
 */
@ApiTags('plans')
@ApiExtraModels(...EDIT_OP_MODELS)
@Controller('plans/:id')
export class PlanBuildingController {
  /** 202 with the run; it finishes in the worker and reports over SSE (AC-PLN-09). */
  @Post('engine-runs')
  @HttpCode(202)
  @RequirePermission('plan:build')
  @UseIdempotency()
  @ApiResource(EngineRunDto, { status: 202 })
  @ApiProblems(409, 412, 428)
  @ApiOperation({ summary: 'Start an Auto-suggest or repair run' })
  startRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartEngineRunDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('POST /plans/{id}/engine-runs', {
      id,
      dto,
      version,
      actor,
    });
  }

  @Get('engine-runs/:runId')
  @RequirePermission('plan:read')
  @ApiResource(EngineRunDto)
  run(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('GET /plans/{id}/engine-runs/{runId}', {
      id,
      runId,
      actor,
    });
  }

  /** 06: every vehicle with what it has left, or why it is unavailable (AC-PLN-15). */
  @Get('vehicle-options')
  @RequirePermission('plan:build')
  @ApiPaginated(PlanVehicleOptionDto)
  @ApiProblems(404)
  vehicleOptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('GET /plans/{id}/vehicle-options', { id, actor });
  }

  /** 07: orders that fit the trip first, then warnings, then blocked ones with why. */
  @Get('order-options')
  @RequirePermission('plan:build')
  @ApiPaginated(OrderOptionDto)
  @ApiProblems(404)
  orderOptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: OrderOptionsQueryDto,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('GET /plans/{id}/order-options', {
      id,
      query,
      actor,
    });
  }

  /** Validates the plan, or the plan with unsaved edits; never saves (AC-PLN-12). */
  @Post('validate')
  @HttpCode(200)
  @RequirePermission('plan:read')
  @ApiResource(ValidationResultDto)
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidatePlanDto,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('POST /plans/{id}/validate', { id, dto, actor });
  }

  /**
   * One edit list (08, 10, 11). Before publish it needs plan:build; after
   * publish the service also asks for plan:revise and a reason code, and the
   * change becomes a revision.
   */
  @Post('edits')
  @HttpCode(200)
  @RequirePermission('plan:build')
  @UseIdempotency()
  @ApiResource(PlanDto)
  @ApiProblems(409, 412, 422, 428)
  edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditPlanDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('POST /plans/{id}/edits', {
      id,
      dto,
      version,
      actor,
    });
  }

  /** Ranked ways out of a violation: another vehicle, a swap, or a deferral (10, 11). */
  @Post('suggest-fixes')
  @HttpCode(200)
  @RequirePermission('plan:build')
  @ApiPaginated(FixDto)
  @ApiProblems(404)
  suggestFixes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuggestFixesDto,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('POST /plans/{id}/suggest-fixes', {
      id,
      dto,
      actor,
    });
  }

  /** DEFER, PLAN_ON or SWAP for unplanned orders, each with a reason (15, 16). */
  @Post('deferrals/decisions')
  @HttpCode(200)
  @RequirePermission('deferral:decide')
  @UseIdempotency()
  @ApiResource(PlanDto)
  @ApiProblems(409, 412, 422, 428)
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeferralDecisionsDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('POST /plans/{id}/deferrals/decisions', {
      id,
      dto,
      version,
      actor,
    });
  }

  /** 17, 18: when publishing opens, what still blocks it, who hears about it. */
  @Get('publish-preview')
  @RequirePermission('plan:publish')
  @ApiResource(PublishPreviewDto)
  publishPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('GET /plans/{id}/publish-preview', { id, actor });
  }

  /**
   * Revision 1. 409 PLAN_LOCKED with opensAt before publishing opens, 409
   * CONFLICT_STATE with the blockers when one appeared since the preview.
   */
  @Post('publish')
  @HttpCode(200)
  @RequirePermission('plan:publish')
  @UseIdempotency()
  @ApiResource(PlanDto)
  @ApiProblems(409, 412, 428)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return notImplemented('POST /plans/{id}/publish', { id, version, actor });
  }
}
