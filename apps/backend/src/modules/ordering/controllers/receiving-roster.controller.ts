import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import {
  ReceivingRosterDto,
  RosterDateQueryDto,
  SetReceivingRosterDto,
} from '../dto/receiving-roster.dto';
import { ReceivingRosterLinks } from '../policies/receiving-roster.links';
import { RosterService } from '../services/roster.service';

/**
 * Who receives deliveries at an outlet, and when (M3). The roster belongs to
 * ordering rather than master data, because it changes day by day with the
 * store's own shifts. A PUT replaces that day's bands outright, and another
 * outlet's roster answers 404 (AC-ORD-28).
 */
@ApiTags('receiving-roster')
@Controller('outlets/:outletId/receiving-roster')
export class ReceivingRosterController {
  constructor(
    private readonly roster: RosterService,
    private readonly links: ReceivingRosterLinks,
  ) {}

  @Get()
  @RequirePermission('order:update')
  @ApiResource(ReceivingRosterDto)
  @ApiOperation({ summary: "A day's receiving roster" })
  async get(
    @Param('outletId') outletId: string,
    @Query() query: RosterDateQueryDto,
    @Actor() actor: SignedIn,
  ) {
    const entries = await this.roster.forDay(outletId, query.date, actor);
    return this.links.one(outletId, query.date, entries, actor);
  }

  @Put()
  @RequirePermission('order:update')
  @ApiResource(ReceivingRosterDto)
  @ApiProblems(400)
  @ApiOperation({ summary: "Replace a day's receiving roster" })
  async replace(
    @Param('outletId') outletId: string,
    @Query() query: RosterDateQueryDto,
    @Body() dto: SetReceivingRosterDto,
    @Actor() actor: SignedIn,
  ) {
    const entries = await this.roster.replaceDay(
      outletId,
      query.date,
      dto,
      actor,
    );
    return this.links.one(outletId, query.date, entries, actor);
  }
}
