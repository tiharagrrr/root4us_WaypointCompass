import { Controller, Get, Param, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  NotFoundError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import {
  AnyRole,
  ApiProblems,
  ApiResource,
} from '../../../core/http/decorators';
import { preview } from '../domain/preview';
import { NotificationPreviewDto } from '../dto/notification.dto';

const CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'] as const;
type PreviewChannel = (typeof CHANNELS)[number];

/**
 * Renders a template with fixture data (AC-NTF-14): development and demo
 * only, so copy can be checked without sending anything. 404 in production.
 */
@ApiTags('notifications')
@Controller('dev/notifications')
export class NotificationPreviewController {
  constructor(private readonly config: ConfigService) {}

  @Get('preview/:event')
  @AnyRole()
  @ApiResource(NotificationPreviewDto)
  @ApiQuery({ name: 'channel', enum: CHANNELS, required: false })
  @ApiQuery({ name: 'locale', required: false, example: 'en' })
  @ApiProblems(400, 404)
  @ApiOperation({
    summary: 'Render a notification template (development only)',
  })
  render(
    @Param('event') event: string,
    @Query('channel') channel = 'IN_APP',
    @Query('locale') locale = 'en',
  ) {
    const open =
      this.config.get<string>('NODE_ENV') !== 'production' ||
      this.config.get<boolean>('DEMO_MODE') === true;
    if (!open) throw new NotFoundError('preview');
    const wanted = channel.toUpperCase();
    if (!(CHANNELS as readonly string[]).includes(wanted))
      throw new ValidationError([
        {
          field: 'channel',
          code: 'invalid',
          message: `One of ${CHANNELS.join(', ')}`,
        },
      ]);
    const result = preview(
      event,
      wanted as PreviewChannel,
      locale,
      this.config.get<string>('APP_URL') ?? '',
    );
    if (!result) throw new NotFoundError('notification template');
    return result;
  }
}
