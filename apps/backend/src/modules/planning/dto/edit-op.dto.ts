import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { BRANDS } from '@waypoint/shared';

/*
 * The plan edit list is a union of eight shapes told apart by `op`: the six
 * the engine applies (packages/engine/src/manual/edit-ops.ts) and the two
 * that are plan data the engine knows nothing about (SET_DRIVER, SET_WAVE).
 * class-validator handles unions badly, so the service parses the list with
 * zod (specs/api-conventions.md, section 8). These classes only describe each
 * shape in OpenAPI, so the generated client gets the union and its mocks.
 */

export class AddTripOpDto {
  @ApiProperty({ enum: ['ADD_TRIP'] })
  op!: 'ADD_TRIP';

  @ApiProperty({ example: 'VEH014' })
  vehicleId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  tripNo!: number;

  @ApiProperty({ enum: BRANDS, enumName: 'Brand', example: 'FRESH' })
  brand!: string;

  @ApiProperty({ example: 'gampaha' })
  districtId!: string;
}

export class RemoveTripOpDto {
  @ApiProperty({ enum: ['REMOVE_TRIP'] })
  op!: 'REMOVE_TRIP';

  @ApiProperty({ example: 'REF-07#2' })
  tripKey!: string;
}

export class AssignOrderOpDto {
  @ApiProperty({ enum: ['ASSIGN_ORDER'] })
  op!: 'ASSIGN_ORDER';

  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  orderId!: string;

  @ApiProperty({ example: 'REF-07#2' })
  tripKey!: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Stop position; the end when omitted',
  })
  position?: number;
}

export class UnassignOrderOpDto {
  @ApiProperty({ enum: ['UNASSIGN_ORDER'] })
  op!: 'UNASSIGN_ORDER';

  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  orderId!: string;
}

export class MoveOrderOpDto {
  @ApiProperty({ enum: ['MOVE_ORDER'] })
  op!: 'MOVE_ORDER';

  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  orderId!: string;

  @ApiProperty({ example: 'REF-07#1' })
  tripKey!: string;

  @ApiPropertyOptional({ minimum: 0 })
  position?: number;
}

export class ResequenceOpDto {
  @ApiProperty({ enum: ['RESEQUENCE'] })
  op!: 'RESEQUENCE';

  @ApiProperty({ example: 'DRY-31#1' })
  tripKey!: string;

  @ApiProperty({
    type: [String],
    description: 'Every order on the trip, in the new stop order',
  })
  orderIds!: string[];
}

export class SetDriverOpDto {
  @ApiProperty({ enum: ['SET_DRIVER'] })
  op!: 'SET_DRIVER';

  @ApiProperty({ example: 'DRY-31#1' })
  tripKey!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Null takes the driver off',
  })
  driverId!: string | null;
}

export class SetWaveOpDto {
  @ApiProperty({ enum: ['SET_WAVE'] })
  op!: 'SET_WAVE';

  @ApiProperty({ example: 'DRY-31#1' })
  tripKey!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Run 1 or Run 2; null clears it',
  })
  waveId!: string | null;
}

/** For @ApiExtraModels, so each variant is in the OpenAPI components. */
export const EDIT_OP_MODELS = [
  AddTripOpDto,
  RemoveTripOpDto,
  AssignOrderOpDto,
  UnassignOrderOpDto,
  MoveOrderOpDto,
  ResequenceOpDto,
  SetDriverOpDto,
  SetWaveOpDto,
];

/** The OpenAPI schema of an edit list: an array of the union, discriminated on `op`. */
export const editOpsSchema = {
  type: 'array' as const,
  items: {
    oneOf: EDIT_OP_MODELS.map((model) => ({ $ref: getSchemaPath(model) })),
    discriminator: { propertyName: 'op' },
  },
};
