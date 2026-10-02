import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Request } from 'express';
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { ALERT_RESOURCE } from '../alert.resource';
import { AlertDto, ResolveAlertDto } from '../dto/alert.dto';
import { AlertLinks } from '../policies/alert.links';
import { AlertQueries } from '../services/alert.queries';
import { AlertsService } from '../services/alerts.service';

/**
 * The dispatcher's alerts: 01's exception panel, 19's alerts column and 19a's
 * alerts for one trip, plus the two things a dispatcher can do about an
 * alert itself.
 *
 * Both writes are POST actions with no `If-Match`: alerts carry no version,
 * because nobody edits an alert — the rules raise it, the fix closes it, and
 * a dispatcher only ever says "I'm on it" or "done, here's what I did".
 */
@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly queries: AlertQueries,
    private readonly alerts: AlertsService,
    private readonly links: AlertLinks,
  ) {}

  /** Open first, then severity (ALERT_RESOURCE's defaultSort). */
  @Get()
  @RequirePermission('alert:read')
  @ApiPaginated(AlertDto, { resource: ALERT_RESOURCE })
  @ApiOperation({ summary: "The depot's alerts, worst first" })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    return this.links.page(await this.queries.list(query, actor), actor, req);
  }

  @Get(':id')
  @RequirePermission('alert:read')
  @ApiResource(AlertDto)
  @ApiProblems(404)
  @ApiOperation({ summary: 'One alert, with its fix' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.queries.get(id, actor), actor);
  }

  /** "I'm on it", so another dispatcher's panel shows who took it. */
  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequirePermission('alert:act')
  @ApiResource(AlertDto)
  @ApiProblems(404, 409)
  @ApiOperation({ summary: "I'm on it" })
  async acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.alerts.acknowledge(id, actor), actor);
  }

  /**
   * Closes an alert the fix cannot close itself, with a note saying what was
   * done. Most alerts never reach here: they resolve themselves.
   */
  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermission('alert:act')
  @ApiResource(AlertDto)
  @ApiProblems(400, 404, 409)
  @ApiOperation({ summary: 'Resolve with a note' })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveAlertDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(
      await this.alerts.resolve(id, actor, dto.note),
      actor,
    );
  }
}
