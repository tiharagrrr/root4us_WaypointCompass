import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IncludeQueryDto, ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  IfMatch,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import { notImplemented } from '../../../core/http/not-implemented';
import { CreateOrderDto, OrderDto } from '../dto/order.dto';
import { OrderTemplateDto, SaveAsTemplateDto } from '../dto/order-template.dto';
import { ORDER_RESOURCE } from '../order.resource';

const SOON =
  'Not implemented yet (501): the contract is final, the service lands next.';

/**
 * Store orders (M1, M1b, M2, M3, M8) and the dispatcher's queue (03, 04).
 *
 * Contract first: the routes, permissions, headers and shapes here are final; every handler
 * answers 501 until the ordering services land, and screens run on the generated MSW mocks
 * meanwhile (specs/ordering/spec.md).
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  /** M3, M8, 03 and 04: the actor's orders, scoped, filtered and paged. */
  @Get()
  @RequirePermission('order:read')
  @ApiPaginated(OrderDto, { resource: ORDER_RESOURCE })
  @ApiOperation({ summary: 'List orders', description: SOON })
  list(@Query() query: ListQueryDto, @Actor() actor: Actor) {
    return notImplemented('GET /orders', { query, actor });
  }

  @Get(':id')
  @RequirePermission('order:read')
  @ApiResource(OrderDto)
  @ApiOperation({ summary: 'One order', description: SOON })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() include: IncludeQueryDto,
    @Actor() actor: Actor,
  ) {
    return notImplemented('GET /orders/{id}', { id, include, actor });
  }

  /** M1: a draft for one class and date; the outlet comes from the actor's scope, never the body. */
  @Post()
  @RequirePermission('order:create')
  @UseIdempotency()
  @ApiResource(OrderDto, { status: 201 })
  @ApiProblems(409)
  @ApiOperation({ summary: 'Start a draft order', description: SOON })
  create(@Body() dto: CreateOrderDto, @Actor() actor: Actor) {
    return notImplemented('POST /orders', { dto, actor });
  }

  /**
   * M1's Send. After the cutoff the order rolls to the next run and the response carries
   * meta.notices ORDER_ROLLED_TO_NEXT_RUN, which M2 shows.
   */
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('order:submit')
  @UseIdempotency()
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Send the order', description: SOON })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Actor() actor: Actor,
  ) {
    return notImplemented('POST /orders/{id}/submit', { id, version, actor });
  }

  /** M1's "Save as preset": this order's lines kept for next time. */
  @Post(':id/save-as-template')
  @RequirePermission('order:create')
  @UseIdempotency()
  @ApiResource(OrderTemplateDto, { status: 201 })
  @ApiProblems(409)
  @ApiOperation({ summary: 'Save the lines as a preset', description: SOON })
  saveAsTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveAsTemplateDto,
    @Actor() actor: Actor,
  ) {
    return notImplemented('POST /orders/{id}/save-as-template', {
      id,
      dto,
      actor,
    });
  }
}
