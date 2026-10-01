import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { notImplemented } from '../../../core/http/not-implemented';
import { ItemDto } from '../dto/item.dto';
import { ITEM_RESOURCE } from '../item.resource';

const SOON =
  'Not implemented yet (501): the contract is final, the service lands next.';

/**
 * The catalog behind M1a's item picker and M9. Read by every role that places or checks an order.
 *
 * Contract first: every handler answers 501 until the master-data queries land.
 */
@ApiTags('items')
@Controller('items')
export class ItemsController {
  /** M1a asks for `filter[tempClass]=AMBIENT&filter[active]=true&limit=100`: one brand's range. */
  @Get()
  @RequirePermission('catalog:read')
  @ApiPaginated(ItemDto, { resource: ITEM_RESOURCE })
  @ApiOperation({ summary: 'List catalog items', description: SOON })
  list(
    @Query() query: ListQueryDto,
    @Actor() actor: Actor,
    @Req() req: Request,
  ) {
    return notImplemented('GET /items', { query, actor, req });
  }

  @Get(':id')
  @RequirePermission('catalog:read')
  @ApiResource(ItemDto)
  @ApiOperation({ summary: 'One catalog item', description: SOON })
  get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: Actor) {
    return notImplemented('GET /items/{id}', { id, actor });
  }
}
