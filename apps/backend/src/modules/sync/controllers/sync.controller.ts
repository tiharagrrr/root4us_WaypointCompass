import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  AnyRole,
  ApiProblems,
  ApiResource,
} from '../../../core/http/decorators';
import { SYNC_BATCH_API_BODY, SyncResponseDto } from '../dto/sync.dto';
import { SyncService } from '../services/sync.service';

/**
 * The offline outbox's far end. Any signed-in role may call it; the service answers 403 to a
 * role that holds neither `stop:record` nor `load:check`, and refuses event by event the kinds
 * the caller may not send (a loader's tablet cannot record a delivery).
 */
@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

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
}
