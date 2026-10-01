import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { can } from '@waypoint/shared';
import type { Request, Response } from 'express';
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  AllowAnonymous,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import {
  AcceptedInvitationDto,
  AcceptInvitationDto,
  CreateInvitationDto,
  InvitationDto,
  InvitationLandingDto,
} from '../dto/invitation.dto';
import { InvitationLinks } from '../policies/invitation.links';
import {
  INVITATIONS,
  InvitationQueries,
  type InvitationRow,
} from '../services/invitation.queries';
import { InvitationsService } from '../services/invitations.service';

/** A1 pending invitations, A2 Invite user and the invite landing (/invite/:token). */
@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly queries: InvitationQueries,
    private readonly invitations: InvitationsService,
    private readonly links: InvitationLinks,
  ) {}

  @Get()
  @RequirePermission('user:create')
  @ApiPaginated(InvitationDto, { resource: INVITATIONS })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: Actor,
    @Req() req: Request,
  ) {
    return this.links.page(await this.queries.list(query, actor), actor, req, {
      create: can(actor, 'user:create') && {
        href: '/api/v1/invitations',
        method: 'POST',
        title: 'Invite user',
        requires: ['Idempotency-Key'],
      },
    });
  }

  /** Sends the link by email, or by SMS to a driver; 72 hours to accept. */
  @Post()
  @RequirePermission('user:create')
  @UseIdempotency()
  @ApiResource(InvitationDto, { status: 201 })
  @ApiProblems(409)
  async create(
    @Body() dto: CreateInvitationDto,
    @Actor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.invitations.create(dto, actor);
    res.location(`/api/v1/invitations/${row.id}`);
    return this.present(row, actor);
  }

  /** The invite landing: who is invited, as what, until when. */
  @Get('by-token/:token')
  @AllowAnonymous()
  @ApiResource(InvitationLandingDto)
  async byToken(@Param('token') token: string) {
    return this.links.landing(await this.invitations.byToken(token), token);
  }

  @Get(':id')
  @RequirePermission('user:create')
  @ApiResource(InvitationDto)
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: Actor) {
    return this.links.one(await this.queries.get(id, actor), actor);
  }

  /** A new link and 72 hours; the old link stops working. */
  @Post(':id/resend')
  @HttpCode(200)
  @RequirePermission('user:create')
  @UseIdempotency()
  @ApiResource(InvitationDto)
  @ApiProblems(409)
  async resend(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: Actor) {
    return this.present(await this.invitations.resend(id, actor), actor);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermission('user:create')
  @ApiResource(InvitationDto)
  @ApiProblems(409)
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: Actor) {
    return this.present(await this.invitations.revoke(id, actor), actor);
  }

  /** Creates the account; email roles and drivers get a session cookie. */
  @Post(':token/accept')
  @AllowAnonymous()
  @HttpCode(200)
  @ApiResource(AcceptedInvitationDto)
  @ApiProblems(409)
  async accept(
    @Param('token') token: string,
    @Body() dto: AcceptInvitationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accepted = await this.invitations.accept(token, dto);
    if (accepted.cookies.length) res.append('Set-Cookie', accepted.cookies);
    return this.links.accepted(accepted);
  }

  /** A command's invitation, with the names A1 shows. */
  private async present(row: InvitationRow, actor: Actor) {
    const [named] = await this.queries.named([row]);
    return this.links.one(named, actor);
  }
}
