import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Request } from 'express';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  RequirePermission,
} from '../../../core/http/decorators';
import { pageLinks } from '../../../core/http/links';
import { TimelineEntryDto } from '../dto/timeline.dto';
import { TimelineService } from '../services/timeline.service';

/**
 * The dispute screen's read: every step an order went through, with who, when, from which
 * device and why. An order's `_links.timeline` points here.
 */
@ApiTags('audit')
@Controller('timelines')
export class TimelinesController {
  constructor(private readonly timelines: TimelineService) {}

  @Get('order/:id')
  @RequirePermission('order:read')
  @ApiPaginated(TimelineEntryDto)
  @ApiProblems(404)
  @ApiOperation({
    summary: "An order's timeline, oldest first",
    description:
      'The order merged with its stops, trip, deferrals, load lines, receipt and issues, by occurredAt. syncedLate marks an offline event recorded more than 5 minutes after it happened.',
  })
  async order(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    const entries = await this.timelines.forOrder(id, actor);
    const page = {
      limit: Math.max(entries.length, 1),
      offset: 0,
      total: entries.length,
    };
    const order = { href: `/api/v1/orders/${id}` };
    return {
      items: entries.map((entry) => ({ ...entry, _links: { order } })),
      page,
      links: { ...pageLinks(req, page), order },
    };
  }
}
