import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Actor, AnyRole } from '../../../core/http/decorators';
import { RootLinks } from '../policies/root.links';

@ApiTags('root')
@Controller()
export class RootController {
  constructor(private readonly links: RootLinks) {}

  /** The web app's first call after sign-in: each role shell picks its landing route from these links. */
  @Get()
  @AnyRole()
  @ApiOperation({ summary: "API root with the caller's landing links" })
  root(@Actor() actor: Actor) {
    return this.links.root(actor);
  }
}
