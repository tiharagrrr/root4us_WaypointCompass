import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import { fieldsOf } from '../domain/field-event';
import { OfflineBundleDto } from '../dto/offline-bundle.dto';
import {
  CantRunDto,
  StartTripDto,
  TripDownloadedDto,
  TripSummaryDto,
} from '../dto/trip.dto';
import { TripLinks } from '../policies/trip.links';
import { TripTrailDto } from '../dto/telematics.dto';
import { TrailQueries } from '../services/trail.queries';
import { MyTripsQueries } from '../services/my-trips.queries';
import { OfflineBundleService } from '../services/offline-bundle.service';
import { StopEventService } from '../services/stop-event.service';

/**
 * One trip as the driver's phone works it (D1, D2, D7, D8, D9).
 *
 * The write handlers are three lines each: `StopEventService` records the
 * field event in one transaction, and the same handler serves the event when
 * it arrives from the offline outbox instead (ROO-44), so an online tap and
 * a replayed one cannot behave differently.
 */
@ApiTags('execution')
@Controller('trips')
export class TripsController {
  constructor(
    private readonly trails: TrailQueries,
    private readonly queries: MyTripsQueries,
    private readonly bundles: OfflineBundleService,
    private readonly events: StopEventService,
    private readonly links: TripLinks,
  ) {}

  /** 19a's breadcrumb: the sampled positions of the trip, oldest first. */
  @Get(':id/trail')
  @RequirePermission('plan:read')
  @ApiResource(TripTrailDto)
  @ApiProblems(403, 404)
  @ApiOperation({ summary: "The trip's GPS trail" })
  async trail(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    return { tripId: id, points: await this.trails.trail(id, actor) };
  }

  @Get(':id')
  @RequirePermission('trip:read')
  @ApiResource(TripSummaryDto)
  @ApiOperation({ summary: 'One trip' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.queries.get(id, actor), actor);
  }

  /**
   * Everything the phone needs for the whole run with no signal: the stops in
   * order, each outlet's window, dock, access notes and contact, and the
   * lines to deliver. Versioned and hashed, so D2 can tell a stale bundle
   * from a fresh one (AC-EXE-04).
   */
  @Get(':id/offline-bundle')
  @RequirePermission('trip:read')
  @ApiResource(OfflineBundleDto)
  @ApiOperation({
    summary: 'The offline bundle',
    description:
      'About 50 KB. `version` is the trip version; `hash` changes whenever anything in the bundle does.',
  })
  async bundle(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    return this.bundles.build(id, actor);
  }

  /** D2: the phone holds the bundle, so the trip is ready to run offline. */
  @Post(':id/downloaded')
  @HttpCode(200)
  @RequirePermission('trip:read')
  @ApiResource(TripSummaryDto)
  @ApiProblems(404, 409)
  @ApiOperation({ summary: 'Confirm the download' })
  async downloaded(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TripDownloadedDto,
    @Actor() actor: SignedIn,
  ) {
    return this.record(id, actor, {
      type: 'TRIP_DOWNLOADED',
      bundleVersion: dto.bundleVersion,
      bundleHash: dto.bundleHash,
      ...fieldsOf(dto),
    });
  }

  /** D1 Start trip. A chilled run reports its reefer temperature (AC-EXE-06). */
  @Post(':id/start')
  @HttpCode(200)
  @RequirePermission('stop:record')
  @ApiResource(TripSummaryDto)
  @ApiProblems(404, 409)
  @ApiOperation({ summary: 'Start the trip' })
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartTripDto,
    @Actor() actor: SignedIn,
  ) {
    return this.record(id, actor, {
      type: 'TRIP_STARTED',
      reeferTempC: dto.reeferTempC ?? null,
      ...fieldsOf(dto),
    });
  }

  /** D7 Finish trip, once every stop has a result (AC-EXE-15). */
  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('stop:record')
  @ApiResource(TripSummaryDto)
  @ApiProblems(404, 409)
  @ApiOperation({ summary: 'Finish the trip' })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartTripDto,
    @Actor() actor: SignedIn,
  ) {
    return this.record(id, actor, { type: 'TRIP_COMPLETED', ...fieldsOf(dto) });
  }

  /** D8 Can't run this trip: the reason reaches the dispatcher (AC-EXE-14). */
  @Post(':id/cant-run')
  @HttpCode(200)
  @RequirePermission('stop:record')
  @ApiResource(TripSummaryDto)
  @ApiProblems(400, 404, 409)
  @ApiOperation({ summary: "Can't run this trip" })
  async cantRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CantRunDto,
    @Actor() actor: SignedIn,
  ) {
    return this.record(id, actor, {
      type: 'CANT_RUN',
      reasonCode: dto.reasonCode,
      note: dto.note,
      attachmentUuids: dto.attachmentUuids,
      ...fieldsOf(dto),
    });
  }

  /** Records the event, then answers with the trip as it now stands. */
  private async record(
    tripId: string,
    actor: SignedIn,
    event: Omit<Parameters<StopEventService['apply']>[0], 'tripId'>,
  ) {
    await this.events.apply({ ...event, tripId }, actor);
    return this.links.one(await this.queries.get(tripId, actor), actor);
  }
}
