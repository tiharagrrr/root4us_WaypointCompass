import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { OutboxService } from '../../../core/outbox/outbox.service';
import { SimpleCrudCommands } from '../../../core/persistence/simple-crud.commands';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { vehicles } from '../../../db/schema';
import { AuditService } from '../../audit';
import type { UpdateVehicleDto } from '../dto/vehicle.dto';
import { VehicleQueries, type VehicleRow } from './vehicle.queries';

/**
 * The vehicle details an admin edits on A5: capacities, fuel figures and the
 * codes it is known by (AC-FLT-07). The status is its own endpoint, because it
 * needs a reason and tells planning to repair; a vehicle's home depot never
 * moves, because a trip points at the pair. Writes take If-Match, audit
 * `fleet.vehicle.updated` and emit `vehicle.updated`.
 */
@Injectable()
export class VehiclesService extends SimpleCrudCommands<
  typeof vehicles,
  never,
  UpdateVehicleDto
> {
  protected readonly table = vehicles;
  protected readonly module = 'fleet';
  protected readonly entityType = 'vehicle';

  constructor(
    txHost: TransactionHost<StampedDrizzleAdapter>,
    audit: AuditService,
    outbox: OutboxService,
    private readonly queries: VehicleQueries,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    super(txHost, audit, outbox);
    this.log.setContext(VehiclesService.name);
  }

  /** The edit A5 makes: scope first, so a vehicle elsewhere is a 404. */
  @Transactional()
  async edit(
    id: string,
    dto: UpdateVehicleDto,
    version: number,
    actor: Actor,
  ): Promise<VehicleRow> {
    await this.queries.get(id, actor);
    const row = await this.update(id, dto, version);
    this.log.info(
      {
        event: 'fleet.vehicle.updated',
        vehicleId: id,
        fields: Object.keys(dto).sort(),
      },
      'vehicle updated',
    );
    return row;
  }

  protected toValues(): never {
    // Vehicles arrive with the fleet (vehicles.csv, the seed); A5 edits them.
    throw new Error('vehicles are created by the seed, not by the API');
  }

  protected toChanges(dto: UpdateVehicleDto) {
    const changes: Partial<typeof vehicles.$inferInsert> = {
      updatedAt: this.clock.realNow(),
    };
    const entries = Object.entries(dto) as [
      keyof UpdateVehicleDto,
      string | number | undefined,
    ][];
    for (const [key, value] of entries)
      if (value !== undefined) Object.assign(changes, { [key]: value });
    return changes;
  }

  protected routing(row: VehicleRow) {
    return { depotId: row.depotId };
  }
}
