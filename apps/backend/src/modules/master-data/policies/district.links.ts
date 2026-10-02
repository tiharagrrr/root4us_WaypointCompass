import { Injectable } from '@nestjs/common';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { DistrictDto } from '../dto/reference.dto';
import type { DistrictRow } from '../services/reference.queries';

/** A district: read-only reference data from the dataset, so only `self`. */
@Injectable()
export class DistrictLinks extends LinkBuilder<
  DistrictRow,
  Omit<DistrictDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(d: DistrictRow) {
    return `/api/v1/districts/${d.id}`;
  }

  protected actions(): LinkMap {
    return {};
  }

  protected present(d: DistrictRow): Omit<DistrictDto, '_links'> {
    return {
      id: d.id,
      name: d.name,
      province: d.province,
      depotId: d.depotId,
      roadClass: d.roadClass,
      freeFlowKmh: d.freeFlowKmh,
      depotToDistrictKm: d.depotToDistrictKm,
      depotToDistrictMin: d.depotToDistrictMin,
      interStopKm: d.interStopKm,
      interStopMin: d.interStopMin,
      centroidLat: d.centroidLat,
      centroidLng: d.centroidLng,
    };
  }
}
