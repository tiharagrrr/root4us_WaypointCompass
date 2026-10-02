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
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import {
  CreateOrderTemplateDto,
  OrderTemplateDto,
  UpdateOrderTemplateDto,
} from '../dto/order-template.dto';
import { ORDER_TEMPLATE_RESOURCE } from '../order-template.resource';
import { OrderTemplateLinks } from '../policies/order-template.links';
import { TemplatesService } from '../services/templates.service';

/**
 * Presets: the saved line sets behind M1's "Preset for this order" and
 * "Load a saved preset", scoped to the store's own outlet.
 */
@ApiTags('order-templates')
@Controller('order-templates')
export class OrderTemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly links: OrderTemplateLinks,
  ) {}

  @Get()
  @RequirePermission('order:create')
  @ApiPaginated(OrderTemplateDto, { resource: ORDER_TEMPLATE_RESOURCE })
  @ApiOperation({ summary: "The outlet's presets" })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    const page = await this.templates.list(query, actor);
    return this.links.page(page, actor, req, {
      create: can(actor, 'order:create') && {
        href: '/api/v1/order-templates',
        method: 'POST',
        title: 'New preset',
      },
    });
  }

  @Get(':id')
  @RequirePermission('order:create')
  @ApiResource(OrderTemplateDto)
  @ApiOperation({ summary: 'One preset' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.templates.get(id, actor), actor);
  }

  @Post()
  @RequirePermission('order:create')
  @UseIdempotency()
  @ApiResource(OrderTemplateDto, { status: 201 })
  @ApiProblems(409)
  @ApiOperation({ summary: 'Save a preset' })
  async create(
    @Body() dto: CreateOrderTemplateDto,
    @Actor() actor: SignedIn,
    @Res({ passthrough: true }) res: Response,
  ) {
    const template = await this.templates.create(dto, actor);
    res.location(`/api/v1/order-templates/${template.id}`);
    return this.links.one(template, actor);
  }

  @Patch(':id')
  @RequirePermission('order:create')
  @ApiResource(OrderTemplateDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Rename a preset' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderTemplateDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.templates.update(id, dto, actor), actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('order:create')
  @ApiOperation({ summary: 'Delete a preset' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ): Promise<void> {
    await this.templates.remove(id, actor);
  }
}
