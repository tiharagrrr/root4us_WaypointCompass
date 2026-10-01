import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Actor,
  ApiProblems,
  ApiResource,
  IfMatch,
  RequirePermission,
} from '../../../core/http/decorators';
import { notImplemented } from '../../../core/http/not-implemented';
import {
  OrderDto,
  OrderLineInputDto,
  OrderLinesDto,
  SetOrderLinesDto,
  UpdateOrderLineDto,
} from '../dto/order.dto';

const SOON =
  'Not implemented yet (501): the contract is final, the service lands next.';

/**
 * The lines of one order: M1's table and the items M1a adds. Every write carries the order's
 * version as If-Match and answers with the order, whose totals and version have moved on, so the
 * screen redraws from one response.
 *
 * Contract first: every handler answers 501 until the ordering services land.
 */
@ApiTags('order-lines')
@Controller('orders/:orderId/lines')
export class OrderLinesController {
  @Get()
  @RequirePermission('order:update')
  @ApiResource(OrderLinesDto)
  @ApiOperation({ summary: "An order's lines", description: SOON })
  list(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Actor() actor: Actor,
  ) {
    return notImplemented('GET /orders/{id}/lines', { orderId, actor });
  }

  /** Replaces every line at once, as applying a preset on M1 does. */
  @Put()
  @RequirePermission('order:update')
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Replace the lines', description: SOON })
  replace(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: SetOrderLinesDto,
    @IfMatch() version: number,
    @Actor() actor: Actor,
  ) {
    return notImplemented('PUT /orders/{id}/lines', {
      orderId,
      dto,
      version,
      actor,
    });
  }

  /** M1a: one item added. A second line for the same item answers 409. */
  @Post()
  @HttpCode(200)
  @RequirePermission('order:update')
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Add a line', description: SOON })
  add(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: OrderLineInputDto,
    @IfMatch() version: number,
    @Actor() actor: Actor,
  ) {
    return notImplemented('POST /orders/{id}/lines', {
      orderId,
      dto,
      version,
      actor,
    });
  }

  /** The quantity stepper on M1 and M1a. */
  @Patch(':lineId')
  @RequirePermission('order:update')
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Change a quantity', description: SOON })
  update(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateOrderLineDto,
    @IfMatch() version: number,
    @Actor() actor: Actor,
  ) {
    return notImplemented('PATCH /orders/{id}/lines/{lineId}', {
      orderId,
      lineId,
      dto,
      version,
      actor,
    });
  }

  /** Answers with the order rather than 204, so M1 redraws its totals from one response. */
  @Delete(':lineId')
  @HttpCode(200)
  @RequirePermission('order:update')
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Remove a line', description: SOON })
  remove(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @IfMatch() version: number,
    @Actor() actor: Actor,
  ) {
    return notImplemented('DELETE /orders/{id}/lines/{lineId}', {
      orderId,
      lineId,
      version,
      actor,
    });
  }
}
