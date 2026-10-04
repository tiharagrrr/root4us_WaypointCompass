import { Body, Controller, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import {
  Actor,
  AnyRole,
  ApiProblems,
  ApiResource,
  IfMatch,
} from '../../../core/http/decorators';
import {
  SetVehicleStatusDto,
  VehicleStatusDto,
} from '../dto/vehicle-status.dto';
import {
  canSetStatus,
  VehicleStatusService,
} from '../services/vehicle-status.service';

/**
 * A5 and 19: take a vehicle out (WORKSHOP, BREAKDOWN) or bring it back
 * (ACTIVE), with a reason (AC-FLT-05). Admins (`masterData:manage`) and
 * dispatchers (`plan:revise`) may; the service checks either permission, so
 * the route only needs a signed-in caller.
 */
@ApiTags('vehicles')
@Controller('vehicles')
export class VehicleStatusController {
  constructor(
    private readonly statuses: VehicleStatusService,
    private readonly clock: ClockService,
  ) {}

  @Put(':id/status')
  @AnyRole()
  @ApiResource(VehicleStatusDto)
  @ApiProblems(400, 403, 404, 412, 428)
  @ApiOperation({ summary: "Set a vehicle's status, with a reason" })
  async setStatus(
    @Param('id') id: string,
    @Body() dto: SetVehicleStatusDto,
    @IfMatch() version: number,
    @Actor() actor: SignedIn,
  ): Promise<VehicleStatusDto> {
    const row = await this.statuses.setStatus(id, version, dto, actor);
    const self = `/api/v1/vehicles/${row.id}`;
    return {
      id: row.id,
      code: row.code,
      depotId: row.depotId,
      status: row.status,
      statusReason: row.statusReason,
      statusChangedAt: row.statusChangedAt
        ? this.clock.toIso(row.statusChangedAt)
        : null,
      version: row.version,
      _links: {
        self: { href: self },
        ...(canSetStatus(actor) && {
          status: {
            href: `${self}/status`,
            method: 'PUT',
            title: 'Set status',
            requires: ['If-Match'],
          },
        }),
      },
    };
  }
}
