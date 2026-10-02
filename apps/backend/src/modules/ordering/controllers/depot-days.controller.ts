import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import { AppConfig } from '../../../config/app-config';
import { NotFoundError } from '../../../core/errors/domain-errors';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import { CloseCutoffResultDto, DepotDaySummaryDto } from '../dto/depot-day.dto';
import { DepotDayLinks } from '../policies/depot-day.links';
import { CutoffCloseService } from '../services/cutoff-close.service';
import { DepotDayQueries } from '../services/depot-day.queries';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One depot's delivery day: the counts 01 Today and 03 Order queue open with,
 * and the demo shortcut that closes the cutoff without waiting for 16:00.
 */
@ApiTags('depot-days')
@Controller('depots/:depotId/days/:date')
export class DepotDaysController {
  constructor(
    private readonly days: DepotDayQueries,
    private readonly closures: CutoffCloseService,
    private readonly links: DepotDayLinks,
    private readonly config: AppConfig,
  ) {}

  @Get()
  @RequirePermission('order:read')
  @ApiResource(DepotDaySummaryDto)
  @ApiOperation({ summary: "A depot's delivery day in numbers" })
  async get(
    @Param('depotId') depotId: string,
    @Param('date') date: string,
    @Actor() actor: SignedIn,
  ) {
    checkDate(date);
    return this.links.one(await this.days.summary(depotId, date, actor), actor);
  }

  /**
   * Closes the cutoff now, so a demo does not have to wait for 16:00. The
   * ticker normally does this; outside demo mode the route does not exist, as
   * every demo tool answers 404 (AC-ORD-25).
   */
  @Post('close-cutoff')
  @HttpCode(200)
  @RequirePermission('order:queue')
  @UseIdempotency()
  @ApiResource(CloseCutoffResultDto)
  @ApiProblems(404)
  @ApiOperation({ summary: 'Close the cutoff now (DEMO_MODE=true only)' })
  async closeCutoff(
    @Param('depotId') depotId: string,
    @Param('date') date: string,
    @Actor() actor: SignedIn,
  ) {
    if (!this.config.demo.enabled) throw new NotFoundError('cutoff close');
    checkDate(date);
    // Reading the day first keeps the depot's scope check in one place: a
    // dispatcher at another depot gets 404 before anything is confirmed.
    await this.days.summary(depotId, date, actor);
    return this.links.closed(await this.closures.close(depotId, date, 'demo'));
  }
}

/** The date is part of the path, so it is checked here rather than by a DTO. */
function checkDate(date: string): void {
  if (
    !BUSINESS_DATE.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  )
    throw new NotFoundError('depot day');
}
