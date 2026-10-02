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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Actor as SignedIn, can } from '@waypoint/shared';
import type { Request, Response } from 'express';
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
import {
  CancelOrderDto,
  CreateOrderDto,
  OrderDto,
  SetOrderPriorityDto,
  UpdateOrderDto,
} from '../dto/order.dto';
import { OrderTemplateDto, SaveAsTemplateDto } from '../dto/order-template.dto';
import { ORDER_RESOURCE } from '../order.resource';
import { OrderLinks } from '../policies/order.links';
import { OrderTemplateLinks } from '../policies/order-template.links';
import { OrderQueries } from '../services/order.queries';
import { OrdersService } from '../services/orders.service';
import { TemplatesService } from '../services/templates.service';

/**
 * Store orders (M1, M1b, M2, M3, M8) and the dispatcher's queue (03, 04).
 *
 * Every handler is three lines: the service does the work in one transaction,
 * and the link builder decides which buttons the caller gets back. Versioned
 * writes carry `If-Match` with the order's version; creates and the actions
 * that must not happen twice carry `Idempotency-Key`
 * (specs/api-conventions.md, section 5).
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly queries: OrderQueries,
    private readonly orders: OrdersService,
    private readonly templates: TemplatesService,
    private readonly links: OrderLinks,
    private readonly templateLinks: OrderTemplateLinks,
  ) {}

  /** M3, M8, 03 and 04: the actor's orders, scoped, filtered and paged. */
  @Get()
  @RequirePermission('order:read')
  @ApiPaginated(OrderDto, { resource: ORDER_RESOURCE })
  @ApiOperation({ summary: 'List orders' })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    const page = await this.queries.list(query, actor);
    return this.links.page(page, actor, req, {
      create: can(actor, 'order:create') && {
        href: '/api/v1/orders',
        method: 'POST',
        title: 'New order',
        requires: ['Idempotency-Key'],
      },
    });
  }

  @Get(':id')
  @RequirePermission('order:read')
  @ApiResource(OrderDto)
  @ApiOperation({ summary: 'One order' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() include: IncludeQueryDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(
      await this.queries.get(id, actor, include.include),
      actor,
    );
  }

  /** M1: a draft for one class and date; the outlet comes from the actor's scope, never the body. */
  @Post()
  @RequirePermission('order:create')
  @UseIdempotency()
  @ApiResource(OrderDto, { status: 201 })
  @ApiProblems(409)
  @ApiOperation({ summary: 'Start a draft order' })
  async create(
    @Body() dto: CreateOrderDto,
    @Actor() actor: SignedIn,
    @Res({ passthrough: true }) res: Response,
  ) {
    const order = await this.orders.createDraft(dto, actor);
    res.location(`/api/v1/orders/${order.id}`);
    return this.links.one(order, actor);
  }

  /** The note and the day asked for, while the order is still editable. */
  @Patch(':id')
  @RequirePermission('order:update')
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Edit an order' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(
      await this.orders.updateDraft(id, dto, actor, version),
      actor,
    );
  }

  /** Removes a draft; anything already sent answers 409 and is cancelled instead. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('order:update')
  @ApiProblems(409)
  @ApiOperation({ summary: 'Delete a draft order' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ): Promise<void> {
    await this.orders.remove(id, actor, version);
  }

  /**
   * M1's Send. After the cutoff the order rolls to the next run and the
   * response carries meta.notices ORDER_ROLLED_TO_NEXT_RUN, which M2 shows.
   */
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('order:submit')
  @UseIdempotency()
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Send the order' })
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.orders.submit(id, actor, version), actor);
  }

  /**
   * A store manager cancels with a note before the cutoff; a dispatcher
   * cancels with a reason code until the order is planned.
   */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('order:cancel')
  @UseIdempotency()
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Cancel the order' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(
      await this.orders.cancel(id, dto, actor, version),
      actor,
    );
  }

  /** M8's Order again: a new draft for the next open date with the same items. */
  @Post(':id/reorder')
  @RequirePermission('order:create')
  @UseIdempotency()
  @ApiResource(OrderDto, { status: 201 })
  @ApiProblems(409)
  @ApiOperation({ summary: 'Order the same again' })
  async reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
    @Res({ passthrough: true }) res: Response,
  ) {
    const order = await this.orders.reorder(id, actor);
    res.location(`/api/v1/orders/${order.id}`);
    return this.links.one(order, actor);
  }

  /** M1's "Save as preset": this order's lines kept for next time. */
  @Post(':id/save-as-template')
  @RequirePermission('order:create')
  @UseIdempotency()
  @ApiResource(OrderTemplateDto, { status: 201 })
  @ApiProblems(409)
  @ApiOperation({ summary: 'Save the lines as a preset' })
  async saveAsTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveAsTemplateDto,
    @Actor() actor: SignedIn,
    @Res({ passthrough: true }) res: Response,
  ) {
    const order = await this.queries.getWithLines(id, actor);
    const template = await this.templates.fromOrder(
      order,
      order.lines ?? [],
      dto.name,
      actor,
    );
    res.location(`/api/v1/order-templates/${template.id}`);
    return this.templateLinks.one(template, actor);
  }

  /** 03: the dispatcher's urgent flag, for example after a priority request. */
  @Patch(':id/priority')
  @RequirePermission('order:queue')
  @ApiResource(OrderDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Mark an order urgent' })
  async setPriority(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOrderPriorityDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(
      await this.orders.setPriority(id, dto, actor, version),
      actor,
    );
  }
}
