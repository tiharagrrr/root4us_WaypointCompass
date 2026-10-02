import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BatchStatus } from '../domain/loader-event';
import { LoadListDto } from './load-list.dto';

/**
 * One item's verdict in a batch (specs/api-conventions.md, section 3: "a
 * batch never fails as a whole because of one bad item"). Keyed by the
 * `clientUuid` the tablet made, because that is the only id it has for a tap
 * it queued while offline.
 */
export class BatchResultDto {
  @ApiProperty() clientUuid!: string;

  @ApiProperty({
    enum: ['applied', 'duplicate', 'conflict', 'rejected'],
    description:
      'applied: it landed. duplicate: it had already landed. conflict: the server moved on. rejected: it cannot land.',
  })
  status!: BatchStatus;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why, for conflict and rejected, e.g. SHORT_WITHOUT_FLAG',
  })
  code?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'What the loader should do about it',
  })
  message?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The row it touched, so the tablet can reconcile its cache',
  })
  id?: string;
}

/** POST /trips/{id}/load-list/checks: a verdict per item, and the new list. */
export class BatchResultsDto {
  @ApiProperty({ type: [BatchResultDto] }) results!: BatchResultDto[];

  @ApiProperty({ description: 'How many items changed something' })
  applied!: number;

  @ApiProperty({
    type: LoadListDto,
    description:
      'The list as it now stands, so the tablet needs no second call',
  })
  list!: LoadListDto;
}
