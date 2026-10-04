import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Request } from 'express';
import {
  Actor,
  AnyRole,
  ApiPaginated,
  ApiProblems,
  ApiResource,
} from '../../../core/http/decorators';
import {
  ChangesQueryDto,
  SYNC_BATCH_API_BODY,
  SyncChangeDto,
  SyncResponseDto,
} from '../dto/sync.dto';
import { ChangesFeed } from '../services/changes-feed.service';
import { SyncService } from '../services/sync.service';

/**
 * The offline outbox's far end. Any signed-in role may call it; the service answers 403 to a
 * role that holds neither `stop:record` nor `load:check`, and refuses event by event the kinds
 * the caller may not send (a loader's tablet cannot record a delivery).
 */
@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly changes: ChangesFeed,
  ) {}

  @Post()
  @HttpCode(200)
  @AnyRole()
  @ApiResource(SyncResponseDto)
  @ApiProblems(400, 403, 413)
  @ApiBody(SYNC_BATCH_API_BODY)
  @ApiOperation({
    summary: 'Replay a device outbox',
    description:
      'Up to 100 driver or loader events, applied in deviceSeq order with one result each: applied, duplicate (already held), conflict (the server moved meanwhile) or rejected (with a code and a message). Never fails as a whole because of one event.',
  })
  async apply(
    @Body() body: unknown,
    @Actor() actor: SignedIn,
  ): Promise<SyncResponseDto> {
    const outcome = await this.sync.apply(body, actor);
    return { ...outcome, _links: { self: { href: '/api/v1/sync' } } };
  }

  @Get('changes')
  @AnyRole()
  @ApiPaginated(SyncChangeDto)
  @ApiProblems(400, 403)
  @ApiOperation({
    summary: 'Server changes to the device’s trips since a cursor',
    description:
      'Revisions, reassignments, re-sequences, cancelled and deferred stops and flag decisions for the trips this device works, oldest first. Send meta.page.nextCursor back as `since`.',
  })
  async pull(
    @Query() query: ChangesQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    const { items, page } = await this.changes.list(actor, query);
    return {
      items: items.map((change) => ({
        ...change,
        occurredAt: change.occurredAt.toISOString(),
        _links: change.tripId
          ? { trip: { href: `/api/v1/trips/${change.tripId}` } }
          : {},
      })),
      page,
      links: {
        self: { href: req.originalUrl },
        first: { href: `/api/v1/sync/changes?limit=${page.limit}` },
        ...(page.nextCursor && {
          next: {
            href: `/api/v1/sync/changes?limit=${page.limit}&since=${page.nextCursor}`,
          },
        }),
      },
    };
  }
}
