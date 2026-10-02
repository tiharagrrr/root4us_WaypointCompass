import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { fieldsOf } from '../domain/field-event';
import {
  ArriveDto,
  CompleteStopDto,
  FailStopDto,
  StopDto,
} from '../dto/stop.dto';
import { StopLinks } from '../policies/stop.links';
import { StopEventService } from '../services/stop-event.service';
import { StopQueries } from '../services/stop.queries';

/**
 * One stop as the driver works it: D3 Arrive, D4 Deliver or part-deliver and
 * D5 Could not deliver. Each handler hands the event to
 * `StopEventService`, which is also what `POST /sync` calls, and answers
 * with the stop as it now stands so D3 to D5 need no second request.
 */
@ApiTags('execution')
@Controller('stops')
export class StopsController {
  constructor(
    private readonly queries: StopQueries,
    private readonly events: StopEventService,
    private readonly links: StopLinks,
  ) {}

  @Get(':id')
  @RequirePermission('stop:read')
  @ApiResource(StopDto)
  @ApiOperation({ summary: 'One stop' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.queries.get(id, actor), actor);
  }

  /** D3: the driver is at the outlet. Out of sequence is allowed (AC-EXE-08). */
  @Post(':id/arrive')
  @HttpCode(200)
  @RequirePermission('stop:record')
  @ApiResource(StopDto)
  @ApiProblems(404, 409)
  @ApiOperation({ summary: 'I am here' })
  async arrive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArriveDto,
    @Actor() actor: SignedIn,
  ) {
    return this.record(id, actor, { type: 'ARRIVED', ...fieldsOf(dto) });
  }

  /**
   * D4: delivered in full or in part. Both need the receiver's name and a
   * signature or photo; a part delivery also needs a note (AC-EXE-10).
   */
  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('stop:record')
  @ApiResource(StopDto)
  @ApiProblems(400, 404, 409)
  @ApiOperation({ summary: 'Delivered' })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteStopDto,
    @Actor() actor: SignedIn,
  ) {
    return this.record(id, actor, {
      type: dto.outcome === 'PARTIAL' ? 'PARTIAL' : 'DELIVERED',
      outcome: dto.outcome,
      receiverName: dto.receiverName,
      note: dto.note ?? null,
      lines: dto.lines,
      attachmentUuids: dto.attachmentUuids,
      ...fieldsOf(dto),
    });
  }

  /** D5: the delivery did not happen, and the note says why (AC-EXE-12). */
  @Post(':id/fail')
  @HttpCode(200)
  @RequirePermission('stop:record')
  @ApiResource(StopDto)
  @ApiProblems(400, 404, 409)
  @ApiOperation({ summary: 'Could not deliver' })
  async fail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailStopDto,
    @Actor() actor: SignedIn,
  ) {
    return this.record(id, actor, {
      type: 'FAILED',
      outcome: dto.outcome,
      note: dto.note,
      attachmentUuids: dto.attachmentUuids,
      ...fieldsOf(dto),
    });
  }

  private async record(
    stopId: string,
    actor: SignedIn,
    event: Omit<Parameters<StopEventService['apply']>[0], 'tripId' | 'stopId'>,
  ) {
    await this.events.apply({ ...event, stopId }, actor);
    return this.links.one(await this.queries.get(stopId, actor), actor);
  }
}
