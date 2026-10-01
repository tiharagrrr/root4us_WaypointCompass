import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import {
  CreateDeferralReasonDto,
  DeferralReasonDto,
  UpdateDeferralReasonDto,
} from '../dto/deferral-reason.dto';
import { DeferralReasonLinks } from '../policies/deferral-reason.links';
import { DeferralReasonsService } from '../services/deferral-reasons.service';

/** A6 deferral reasons; dispatchers and stores read them on deferrals. */
@ApiTags('deferral-reasons')
@Controller('deferral-reasons')
export class DeferralReasonsController {
  constructor(
    private readonly reasons: DeferralReasonsService,
    private readonly links: DeferralReasonLinks,
  ) {}

  @Get()
  @RequirePermission('deferral:read')
  @ApiPaginated(DeferralReasonDto)
  async list(@Actor() actor: Actor) {
    return this.links.list(await this.reasons.list(), actor);
  }

  @Get(':code')
  @RequirePermission('deferral:read')
  @ApiResource(DeferralReasonDto)
  async get(@Param('code') code: string, @Actor() actor: Actor) {
    return this.links.one(await this.reasons.get(code), actor);
  }

  @Post()
  @RequirePermission('settings:manage')
  @ApiResource(DeferralReasonDto, { status: 201 })
  @ApiProblems(409)
  async create(
    @Body() dto: CreateDeferralReasonDto,
    @Actor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.reasons.create(dto);
    res.location(`/api/v1/deferral-reasons/${row.code}`);
    return this.links.one(row, actor);
  }

  /** 409 when it would switch off an engine reason. */
  @Patch(':code')
  @RequirePermission('settings:manage')
  @ApiResource(DeferralReasonDto)
  @ApiProblems(409)
  async update(
    @Param('code') code: string,
    @Body() dto: UpdateDeferralReasonDto,
    @Actor() actor: Actor,
  ) {
    return this.links.one(await this.reasons.update(code, dto), actor);
  }
}
