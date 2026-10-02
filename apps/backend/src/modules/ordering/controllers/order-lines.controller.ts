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
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiProblems,
  ApiResource,
  IfMatch,
  RequirePermission,
} from '../../../core/http/decorators';
import {
  OrderDto,
  OrderLineInputDto,
  OrderLinesDto,
  SetOrderLinesDto,
  UpdateOrderLineDto,
} from '../dto/order.dto';
import { OrderLinks } from '../policies/order.links';
import { OrderLinesService } from '../services/order-lines.service';
import { OrderQueries } from '../services/order.queries';

/**
 * The lines of one order: M1's table and the items M1a adds. Every write
 * carries the order's version as If-Match and answers with the order, whose
 * totals and version have moved on, so the screen redraws from one response.
 */
@ApiTags('order-lines')
@Controller('orders/:orderId/lines')
export class OrderLinesController {
  constructor(
    private readonly lines: OrderLinesService,
    private readonly queries: OrderQueries,
    private readonly links: OrderLinks,
  ) {}

  @Get()
  @RequirePermission('order:update')
  @ApiResource(OrderLinesDto)
  @ApiOperation({ summary: "An order's lines" })
  async list(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Actor() actor: SignedIn,
  ) {
    return this.links.lines(
      await this.queries.getWithLines(orderId, actor),
      actor,
    );
  }

  /** Replaces every line at once, as applying a preset on M1 does. */
  @Put()
  @RequirePermission('order:update')
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Replace the lines' })
  async replace(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: SetOrderLinesDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(
      await this.lines.replace(orderId, dto, actor, version),
      actor,
    );
  }

  /** M1a: one item added. A second line for the same item answers 409. */
  @Post()
  @HttpCode(200)
  @RequirePermission('order:update')
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Add a line' })
  async add(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: OrderLineInputDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(
      await this.lines.add(orderId, dto, actor, version),
      actor,
    );
  }

  /** The quantity stepper on M1 and M1a. */
  @Patch(':lineId')
  @RequirePermission('order:update')
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Change a quantity' })
  async update(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateOrderLineDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(
      await this.lines.setQty(orderId, lineId, dto, actor, version),
      actor,
    );
  }

  /** Answers with the order rather than 204, so M1 redraws its totals from one response. */
  @Delete(':lineId')
  @HttpCode(200)
  @RequirePermission('order:update')
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Remove a line' })
  async remove(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(
      await this.lines.remove(orderId, lineId, actor, version),
      actor,
    );
  }
}
