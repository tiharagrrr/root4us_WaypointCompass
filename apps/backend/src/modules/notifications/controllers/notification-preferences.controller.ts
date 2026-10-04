import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  AnyRole,
  ApiProblems,
  ApiResource,
} from '../../../core/http/decorators';
import {
  NotificationPreferenceDto,
  NotificationPreferencesDto,
  UpdateNotificationPreferenceDto,
} from '../dto/notification.dto';
import { NotificationLinks } from '../policies/notification.links';
import { PreferencesService } from '../services/preferences.service';

/** Everyone's own notification preferences: D12 on the phone, 02's Settings on the desktop. */
@ApiTags('notifications')
@Controller('me/notification-preferences')
export class NotificationPreferencesController {
  constructor(
    private readonly preferences: PreferencesService,
    private readonly links: NotificationLinks,
  ) {}

  @Get()
  @AnyRole()
  @ApiResource(NotificationPreferencesDto)
  @ApiOperation({ summary: 'My notification preferences, per event' })
  async list(@Actor() actor: SignedIn) {
    return this.links.preferences(await this.preferences.sheet(actor));
  }

  @Post('resume-email')
  @HttpCode(200)
  @AnyRole()
  @ApiResource(NotificationPreferencesDto)
  @ApiOperation({ summary: 'Turn email back on after a bounce' })
  async resumeEmail(@Actor() actor: SignedIn) {
    return this.links.preferences(await this.preferences.resumeEmail(actor));
  }

  @Put(':eventType')
  @AnyRole()
  @ApiResource(NotificationPreferenceDto)
  @ApiProblems(400, 404)
  @ApiOperation({ summary: 'Choose the channels for one event' })
  async update(
    @Param('eventType') eventType: string,
    @Body() dto: UpdateNotificationPreferenceDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.preference(
      await this.preferences.update(actor, eventType, dto.channels),
    );
  }
}
