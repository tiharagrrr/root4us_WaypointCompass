import {
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
  AnyRole,
  ApiPaginated,
  ApiProblems,
  ApiResource,
} from '../../../core/http/decorators';
import {
  NotificationDto,
  NotificationSummaryDto,
  ReadAllResultDto,
} from '../dto/notification.dto';
import { NOTIFICATION_RESOURCE } from '../notification.resource';
import { NotificationLinks } from '../policies/notification.links';
import { NotificationQueries } from '../services/notification.queries';
import { NotificationsService } from '../services/notifications.service';

/** The 02 bell: everyone's own in-app notifications, and marking them read. */
@ApiTags('notifications')
@Controller('me/notifications')
export class MyNotificationsController {
  constructor(
    private readonly queries: NotificationQueries,
    private readonly notifications: NotificationsService,
    private readonly links: NotificationLinks,
  ) {}

  @Get()
  @AnyRole()
  @ApiPaginated(NotificationDto, { resource: NOTIFICATION_RESOURCE })
  @ApiOperation({ summary: 'My notifications, newest first' })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    return this.links.page(await this.queries.list(query, actor), actor, req);
  }

  @Get('summary')
  @AnyRole()
  @ApiResource(NotificationSummaryDto)
  @ApiOperation({ summary: 'The unread count on the bell' })
  async summary(@Actor() actor: SignedIn) {
    return this.links.summary(await this.queries.unread(actor));
  }

  @Post('read-all')
  @HttpCode(200)
  @AnyRole()
  @ApiResource(ReadAllResultDto)
  @ApiOperation({ summary: 'Mark every notification read' })
  readAll(@Actor() actor: SignedIn) {
    return this.notifications.markAllRead(actor);
  }

  @Post(':id/read')
  @HttpCode(200)
  @AnyRole()
  @ApiResource(NotificationDto)
  @ApiProblems(404)
  @ApiOperation({ summary: 'Mark one notification read' })
  async read(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.notifications.markRead(id, actor), actor);
  }
}
