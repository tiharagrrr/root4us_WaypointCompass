import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import { SettingsService } from '../../../core/settings/settings.service';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { DepotDto, UpdateDepotDto } from '../dto/depot.dto';
import { type DepotView, DepotLinks } from '../policies/depot.links';
import { wholeList } from '../policies/whole-list';
import { DepotsService } from '../services/depots.service';
import { type DepotRow, ReferenceQueries } from '../services/reference.queries';

const BASE = '/api/v1/depots';

/**
 * Depots (A4). Each row carries the cutoff minute actually in force for it:
 * its own override, or the global `ordering.cutoffMin`, so a screen never
 * has to resolve the setting itself.
 */
@ApiTags('depots')
@Controller('depots')
export class DepotsController {
  constructor(
    private readonly reference: ReferenceQueries,
    private readonly depots: DepotsService,
    private readonly settings: SettingsService,
    private readonly links: DepotLinks,
  ) {}

  @Get()
  @RequirePermission('masterData:read')
  @ApiPaginated(DepotDto)
  @ApiOperation({ summary: 'List depots' })
  async list(@Actor() actor: SignedIn) {
    const rows = await this.reference.depots();
    return wholeList(this.links, await this.withCutoff(rows), actor, BASE);
  }

  @Get(':id')
  @RequirePermission('masterData:read')
  @ApiResource(DepotDto)
  @ApiOperation({ summary: 'One depot' })
  async get(@Param('id') id: string, @Actor() actor: SignedIn) {
    const row = await this.reference.depot(id);
    return this.links.one((await this.withCutoff([row]))[0], actor);
  }

  /** A4: docks, chilled docks and the cutoff override (AC-MD-06). */
  @Patch(':id')
  @RequirePermission('masterData:manage')
  @ApiResource(DepotDto)
  @ApiProblems(400)
  @ApiOperation({ summary: 'Edit depot settings' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDepotDto,
    @Actor() actor: SignedIn,
  ) {
    const row = await this.depots.update(id, dto);
    return this.links.one((await this.withCutoff([row]))[0], actor);
  }

  /**
   * The cutoff minute actually in force at each depot: its own column, then
   * the `ordering.cutoffMin` setting resolved for that depot (A6 may override
   * it per depot), then the setting's default. The same order as
   * `CutoffService.cutoffMinFor`, so A4 shows the minute the cutoff job uses.
   */
  private async withCutoff(rows: DepotRow[]): Promise<DepotView[]> {
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        effectiveCutoffMin:
          row.cutoffMin ??
          (await this.settings.get('ordering.cutoffMin', row.id)),
      })),
    );
  }
}
