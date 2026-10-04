import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { SkipTransaction } from '../../../core/persistence/actor-transaction.interceptor';
import { PingBatchDto, PingResultDto } from '../dto/telematics.dto';
import { TelematicsService } from '../services/telematics.service';

/**
 * The driver's phone sends its GPS fixes here, in batches from the offline
 * outbox. The route manages its own transaction: positions go to the screens
 * only after the rows commit.
 */
@ApiTags('telematics')
@Controller('telematics')
export class TelematicsController {
  constructor(private readonly telematics: TelematicsService) {}

  @Post('pings')
  @HttpCode(200)
  @RequirePermission('stop:record')
  @SkipTransaction()
  @ApiResource(PingResultDto)
  @ApiProblems(400, 403, 413)
  @ApiOperation({ summary: 'Up to 200 GPS fixes for running trips' })
  pings(@Body() dto: PingBatchDto, @Actor() actor: SignedIn) {
    return this.telematics.receive(dto.pings, { kind: 'driver', actor });
  }
}
