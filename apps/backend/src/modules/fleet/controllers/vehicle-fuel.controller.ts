import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Actor as SignedIn,
  businessDateOf,
  isoWeekOf,
} from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { FuelWeekDto, FuelWeekQueryDto } from '../dto/fuel-week.dto';
import {
  FuelLedgerService,
  type IsoWeek,
} from '../services/fuel-ledger.service';
import { VehicleQueries } from '../services/vehicle.queries';

/** A vehicle's fuel for a week against its quota (A5, 06). */
@ApiTags('vehicles')
@Controller('vehicles')
export class VehicleFuelController {
  constructor(
    private readonly vehicles: VehicleQueries,
    private readonly ledger: FuelLedgerService,
    private readonly clock: ClockService,
  ) {}

  @Get(':id/fuel')
  @RequirePermission('plan:read')
  @ApiResource(FuelWeekDto)
  @ApiProblems(404)
  @ApiOperation({ summary: "A vehicle's fuel for one ISO week" })
  async fuel(
    @Param('id') id: string,
    @Query() query: FuelWeekQueryDto,
    @Actor() actor: SignedIn,
  ): Promise<FuelWeekDto> {
    const vehicle = await this.vehicles.get(id, actor);
    const week = query.week
      ? parseIsoWeek(query.week)
      : isoWeekOf(businessDateOf(this.clock.now()));
    const fuel = await this.ledger.weekOf(vehicle.id, week);
    return {
      ...fuel,
      _links: {
        self: {
          href: `/api/v1/vehicles/${vehicle.id}/fuel?week=${formatIsoWeek(week)}`,
        },
      },
    };
  }
}

/** "2026-W40" to { isoYear: 2026, isoWeek: 40 }; the DTO has checked the shape. */
function parseIsoWeek(week: string): IsoWeek {
  const [year, w] = week.split('-W');
  return { isoYear: Number(year), isoWeek: Number(w) };
}

function formatIsoWeek({ isoYear, isoWeek }: IsoWeek): string {
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}
