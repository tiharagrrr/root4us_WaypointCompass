import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiPaginated,
  RequirePermission,
} from '../../../core/http/decorators';
import { DistrictDto } from '../dto/reference.dto';
import { DistrictLinks } from '../policies/district.links';
import { wholeList } from '../policies/whole-list';
import { ReferenceQueries } from '../services/reference.queries';

/** Districts with the travel figures the engine and the map read (AC-MD-11). */
@ApiTags('districts')
@Controller('districts')
export class DistrictsController {
  constructor(
    private readonly reference: ReferenceQueries,
    private readonly links: DistrictLinks,
  ) {}

  @Get()
  @RequirePermission('masterData:read')
  @ApiPaginated(DistrictDto)
  @ApiOperation({ summary: 'List districts' })
  async list(@Actor() actor: SignedIn) {
    return wholeList(
      this.links,
      await this.reference.districts(),
      actor,
      '/api/v1/districts',
    );
  }
}
