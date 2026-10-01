import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DemoInbox } from '../../../core/demo/demo-inbox';
import { NotFoundError } from '../../../core/errors/domain-errors';
import {
  AllowAnonymous,
  AnyRole,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { DemoResetDto } from '../dto/settings.dto';
import { DemoUsersDto } from '../dto/user.dto';
import { DemoCommands } from '../services/demo.commands';
import { DemoQueries } from '../services/demo.queries';

@ApiTags('demo')
@Controller('demo')
export class DemoController {
  constructor(
    private readonly inbox: DemoInbox,
    private readonly demo: DemoCommands,
    private readonly queries: DemoQueries,
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

  /**
   * Who the account menu can switch to, in the order a demo walks the day. Any signed-in role may
   * read it, and only in demo mode: otherwise it does not exist (404). Switching itself is
   * POST /api/auth/sign-in/demo (auth/demo-switch.plugin.ts).
   */
  @Get('users')
  @AnyRole()
  @ApiOperation({
    summary: 'Demo users to switch between (DEMO_MODE=true only)',
  })
  @ApiResource(DemoUsersDto)
  async users(): Promise<DemoUsersDto> {
    return { users: await this.queries.cast() };
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
