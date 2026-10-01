import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import { notImplemented } from '../../../core/http/not-implemented';
import {
  CreateOrderTemplateDto,
  OrderTemplateDto,
} from '../dto/order-template.dto';
import { ORDER_TEMPLATE_RESOURCE } from '../order-template.resource';

const SOON =
  'Not implemented yet (501): the contract is final, the service lands next.';

/**
 * Presets: the saved line sets behind M1's "Preset for this order" and "Load a saved preset",
 * scoped to the store's own outlet.
 *
 * Contract first: every handler answers 501 until the ordering services land.
 */
@ApiTags('order-templates')
@Controller('order-templates')
export class OrderTemplatesController {
  @Get()
  @RequirePermission('order:create')
  @ApiPaginated(OrderTemplateDto, { resource: ORDER_TEMPLATE_RESOURCE })
  @ApiOperation({ summary: "The outlet's presets", description: SOON })
  list(
    @Query() query: ListQueryDto,
    @Actor() actor: Actor,
    @Req() req: Request,
  ) {
    return notImplemented('GET /order-templates', { query, actor, req });
  }

  @Post()
  @RequirePermission('order:create')
  @UseIdempotency()
  @ApiResource(OrderTemplateDto, { status: 201 })
  @ApiProblems(409)
  @ApiOperation({ summary: 'Save a preset', description: SOON })
  create(@Body() dto: CreateOrderTemplateDto, @Actor() actor: Actor) {
    return notImplemented('POST /order-templates', { dto, actor });
  }
}
