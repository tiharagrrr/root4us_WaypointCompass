import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DemoInbox } from '../../../core/demo/demo-inbox';
import { NotFoundError } from '../../../core/errors/domain-errors';
import { AllowAnonymous } from '../../../core/http/decorators';

@ApiTags('demo')
@Controller('demo')
export class DemoController {
  constructor(private readonly inbox: DemoInbox) {}

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
}
