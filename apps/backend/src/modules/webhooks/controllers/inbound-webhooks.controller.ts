import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  NotFoundError,
  UnauthenticatedError,
} from '../../../core/errors/domain-errors';
import { AllowAnonymous } from '../../../core/http/decorators';
import { SkipTransaction } from '../../../core/persistence/actor-transaction.interceptor';
import { InboundWebhooksService } from '../inbound/inbound-webhooks.service';

/**
 * POST /webhooks/{provider}: public, raw body (app.setup.ts), signature
 * checked. It manages its own transaction so a rejected call is stored before
 * the 401 goes out. Resend is the only provider wired so far.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class InboundWebhooksController {
  constructor(private readonly inbound: InboundWebhooksService) {}

  @Post('resend')
  @HttpCode(200)
  @AllowAnonymous()
  @SkipTransaction()
  @ApiExcludeEndpoint()
  async resend(
    @Req() req: Request,
    @Headers('svix-id') id?: string,
    @Headers('svix-timestamp') timestamp?: string,
    @Headers('svix-signature') signature?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    if (!this.inbound.resendEnabled) throw new NotFoundError('webhook');
    const body: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body ?? {}));
    const receipt = await this.inbound.receiveResend(
      { id, timestamp, signature, 'user-agent': userAgent },
      body,
    );
    if (receipt === 'rejected') throw new UnauthenticatedError();
    return { received: true, receipt };
  }
}
