import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Request } from 'express';
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { ItemDto } from '../dto/item.dto';
import { ITEM_RESOURCE } from '../item.resource';
import { ItemLinks } from '../policies/item.links';
import { ItemQueries } from '../services/item.queries';

/** The catalog behind M1a's item picker and M9. Read by every role that places or checks an order. */
@ApiTags('items')
@Controller('items')
export class ItemsController {
  constructor(
    private readonly queries: ItemQueries,
    private readonly links: ItemLinks,
  ) {}

  /** M1a asks for `filter[tempClass]=AMBIENT&filter[active]=true&limit=100`: one brand's range. */
  @Get()
  @RequirePermission('catalog:read')
  @ApiPaginated(ItemDto, { resource: ITEM_RESOURCE })
  @ApiOperation({ summary: 'List catalog items' })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    const page = await this.queries.list(query);
    return this.links.page(page, actor, req);
  }

  @Get(':id')
  @RequirePermission('catalog:read')
  @ApiResource(ItemDto)
  @ApiOperation({ summary: 'One catalog item' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.queries.get(id), actor);
  }
}
