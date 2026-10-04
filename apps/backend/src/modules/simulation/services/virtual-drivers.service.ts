import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { JobContextRunner } from '../../../core/context/job-context';
import { DomainError } from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { stops, trips, users } from '../../../db/schema';
import { StopEventService } from '../../execution';
import {
  type DriverStep,
  stepsDue,
  stepUuid,
  type Trouble,
} from '../domain/virtual-driver';
import { SIMULATION_LOGS } from '../simulation.constants';
import type { RunView } from './simulation.queries';

/**
 * One virtual driver per released trip that has a driver (AC-SIM-04). Each
 * step goes through execution's StopEventService.apply, the handler behind
 * both the driver's online endpoints and POST /sync, as that trip's driver
 * and with SIMULATION as the audit source, so ETAs, alerts, notifications and
 * receipts see what they would see from a phone. Each step is its own
 * transaction, like one tap, taken at the simulated instant it happens.
 * Position pings wait for POST /telematics/pings (ROO-37).
 */
@Injectable()
export class VirtualDrivers {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly jobs: JobContextRunner,
    private readonly clock: ClockService,
    private readonly events: StopEventService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(VirtualDrivers.name);
  }

  /** Records everything the plan's drivers have done by the run's simulated now. */
  async drive(run: RunView): Promise<void> {
    if (!run.planId || !run.simNow) return;
    const planId = run.planId;
    const now = run.simNow;
    const trouble: Trouble[] = run.injections;
    const rows = await this.jobs.run({ id: `simulation:${run.id}` }, () =>
      this.txHost.tx
        .select({ trip: trips, driverName: users.name })
        .from(trips)
        .innerJoin(users, eq(users.id, trips.driverId))
        .where(
          and(
            eq(trips.planId, planId),
            isNotNull(trips.driverId),
            inArray(trips.status, ['RELEASED', 'IN_PROGRESS']),
          ),
        )
        .orderBy(asc(trips.plannedDepartAt), asc(trips.id)),
    );

    for (const { trip, driverName } of rows) {
      const actor: Actor = {
        id: trip.driverId!,
        name: driverName,
        role: 'driver',
        depotId: trip.depotId,
        outletId: null,
        vehicleId: trip.vehicleId,
        deviceId: null,
      };
      const tripStops = await this.jobs.run(
        { id: `simulation:${run.id}` },
        () =>
          this.txHost.tx
            .select()
            .from(stops)
            .where(eq(stops.tripId, trip.id))
            .orderBy(asc(stops.seq)),
      );
      for (const step of stepsDue(trip, tripStops, trouble, now, run.seed)) {
        const applied = await this.record(run, trip, step, actor);
        if (!applied) break;
      }
    }
    this.clock.set({
      mode: 'simulated',
      runId: run.id,
      at: this.clock.toIso(now),
    });
  }

  private async record(
    run: RunView,
    trip: typeof trips.$inferSelect,
    step: DriverStep,
    actor: Actor,
  ): Promise<boolean> {
    // The server receives the event at the instant the driver records it.
    this.clock.set({
      mode: 'simulated',
      runId: run.id,
      at: this.clock.toIso(step.at),
    });
    try {
      await this.jobs.run({ id: `simulation:${run.id}`, actor }, () =>
        this.events.apply(
          {
            clientUuid: stepUuid(run.id, trip.id, step),
            type: step.type,
            tripId: trip.id,
            stopId: step.stopId,
            occurredAt: step.at,
            source: 'SIMULATION',
            ...(step.type === 'TRIP_STARTED' &&
              trip.tempClass === 'CHILLED' && { reeferTempC: 3 }),
            ...(step.type === 'DELIVERED' && {
              outcome: 'DELIVERED' as const,
              receiverName: step.receiverName,
              attachmentUuids: [stepUuid(run.id, trip.id, step, 'signature')],
            }),
            ...(step.type === 'FAILED' && {
              outcome: step.outcome,
              note: `Simulated: ${step.outcome?.toLowerCase().replace('_', ' ')}`,
            }),
          },
          actor,
        ),
      );
      return true;
    } catch (error: unknown) {
      // A refusal (the dispatcher changed the trip, say) stops this driver for now.
      if (!(error instanceof DomainError)) throw error;
      this.log.warn(
        {
          event: SIMULATION_LOGS.driverRefused,
          runId: run.id,
          tripId: trip.id,
          type: step.type,
          code: error.code,
        },
        'virtual driver refused',
      );
      return false;
    }
  }
}
