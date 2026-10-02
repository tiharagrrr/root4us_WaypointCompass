import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ALERT_STATUSES,
  ALERT_TYPES,
  type AlertStatus,
  type AlertType,
  type Links,
} from '@waypoint/shared';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/** The longest resolution note the panel's box takes. */
export const RESOLUTION_MAX = 500;

/**
 * One alert as 01's exception panel and 19's alerts column show it: what is
 * wrong, how bad, what it is about, and in `_links` the fix — but only when
 * the viewer may take it (AlertLinks).
 */
export class AlertDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ALERT_TYPES }) type!: AlertType;
  @ApiProperty({ enum: ALERT_STATUSES }) status!: AlertStatus;

  @ApiProperty({
    enum: [1, 2, 3],
    description: '1 critical, 2 warning, 3 information',
  })
  severity!: number;

  /**
   * The severity as words. 01, 19 and 19a must not show status by colour
   * alone, so the server sends the label rather than leaving each screen to
   * invent one (specs/alerts/spec.md, Non-functional).
   */
  @ApiProperty({ enum: ['Critical', 'Warning', 'Information'] })
  severityLabel!: string;

  @ApiProperty() title!: string;
  @ApiProperty() depotId!: string;

  @ApiPropertyOptional({ type: Object, nullable: true })
  detail!: unknown;

  @ApiProperty({
    description: 'One open alert per key, e.g. LATE_RISK:stop:<id>',
  })
  dedupeKey!: string;

  @ApiPropertyOptional({ nullable: true }) tripId!: string | null;
  @ApiPropertyOptional({ nullable: true }) stopId!: string | null;
  @ApiPropertyOptional({ nullable: true }) orderId!: string | null;
  @ApiPropertyOptional({ nullable: true }) outletId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Who reported it; null when a rule raised it',
  })
  raisedById!: string | null;

  @ApiProperty() raisedAt!: string;

  @ApiPropertyOptional({ nullable: true })
  acknowledgedById!: string | null;
  @ApiPropertyOptional({ nullable: true }) acknowledgedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null when the alert resolved itself',
  })
  resolvedById!: string | null;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) resolution!: string | null;

  /** What closes this alert, in words, for the panel's detail row. */
  @ApiProperty() resolvesWhen!: string;

  @ApiProperty({ type: Object }) _links!: Links;
}

/** POST /alerts/{id}/resolve: a note saying what was done about it. */
export class ResolveAlertDto {
  @ApiProperty({ maxLength: RESOLUTION_MAX })
  @IsString()
  @IsNotEmpty({ message: 'Say what you did about it' })
  // A note of spaces is as empty as no note at all, and the audit row and the
  // panel's "resolved because" line both go on to show it (AC-ALR-08).
  @Matches(/\S/, { message: 'Say what you did about it' })
  @MaxLength(RESOLUTION_MAX)
  note!: string;
}
