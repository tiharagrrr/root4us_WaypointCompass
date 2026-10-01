import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DemoInbox } from '../../../core/demo/demo-inbox';
import { NotFoundError } from '../../../core/errors/domain-errors';
import {
  AllowAnonymous,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { DemoResetDto } from '../dto/settings.dto';
import { DemoCommands } from '../services/demo.commands';

@ApiTags('demo')
@Controller('demo')
export class DemoController {
  constructor(
    private readonly inbox: DemoInbox,
    private readonly demo: DemoCommands,
  ) {}

  /**
   * The last 50 SMS and emails, newest first, so judges can read sign-in
   * codes. Public, and only in demo mode: otherwise it does not exist (404).
   */
  @Get('inbox')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Demo inbox (DEMO_MODE=true only)' })
  async list() {
    if (!this.inbox.enabled) throw new NotFoundError('demo inbox');
    return this.inbox.list();
  }

  /** A6 Reset demo day; 404 unless DEMO_MODE=true. */
  @Post('reset')
  @HttpCode(200)
  @RequirePermission('settings:manage')
  @ApiResource(DemoResetDto)
  @ApiResponse({
    status: 501,
    description: 'Until the S1 demo-day seed exists (ROO-22)',
  })
  reset() {
    return this.demo.resetDemoDay();
  }
}
