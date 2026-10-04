import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NOTIFICATION_CHANNELS,
  type Links,
  type NotificationChannel,
} from '@waypoint/shared';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';

const OFFERED = NOTIFICATION_CHANNELS.filter((c) => c !== 'WHATSAPP');

/** One line in the 02 bell. */
export class NotificationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'deferral.confirmed' }) eventType!: string;
  @ApiProperty({ example: 'Order WF-0171 moves to Fri 2 Oct' })
  title!: string;
  @ApiProperty({
    example: 'Order WF-0171 moves to Fri 2 Oct: no reefer capacity.',
  })
  body!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The web route the notification opens',
    example: '/store/deferrals/0192…',
  })
  link!: string | null;

  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ nullable: true }) readAt!: string | null;

  @ApiProperty({ type: Object }) _links!: Links;
}

/** The badge on the bell. */
export class NotificationSummaryDto {
  @ApiProperty({ example: 3 }) unread!: number;
  @ApiProperty({ type: Object }) _links!: Links;
}

/** POST /me/notifications/read-all. */
export class ReadAllResultDto {
  @ApiProperty({ example: 3 }) marked!: number;
}

/** One event on the preference screen (D12, 02's Settings). */
export class NotificationPreferenceDto {
  @ApiProperty({ example: 'deferral.confirmed' }) eventType!: string;
  @ApiProperty({ example: 'Order deferred' }) label!: string;
  @ApiPropertyOptional({ nullable: true }) example!: string | null;
  @ApiProperty({ enum: OFFERED, isArray: true })
  defaults!: NotificationChannel[];
  @ApiProperty({
    enum: OFFERED,
    isArray: true,
    description: 'What this person can receive now',
  })
  available!: NotificationChannel[];
  @ApiProperty({ enum: OFFERED, isArray: true })
  channels!: NotificationChannel[];
  @ApiProperty() custom!: boolean;
  @ApiProperty({ type: Object }) _links!: Links;
}

export class NotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceDto] })
  items!: NotificationPreferenceDto[];
  @ApiProperty({
    description: 'Email is off for everything after a bounce or complaint',
  })
  emailSuppressed!: boolean;
  @ApiProperty({ type: Object }) _links!: Links;
}

/** PUT /me/notification-preferences/{eventType}. In-app is always kept. */
export class UpdateNotificationPreferenceDto {
  @ApiProperty({ enum: OFFERED, isArray: true, example: ['IN_APP', 'PUSH'] })
  @IsArray()
  @ArrayUnique()
  @IsIn(OFFERED, { each: true })
  channels!: NotificationChannel[];
}

/** GET /dev/notifications/preview/{event}. */
export class NotificationPreviewDto {
  @ApiProperty() eventType!: string;
  @ApiProperty({ enum: OFFERED }) channel!: NotificationChannel;
  @ApiProperty() requestedLocale!: string;
  @ApiProperty({
    description: 'The locale the copy is in (English until ROO-66)',
  })
  locale!: string;
  @ApiProperty({ type: Object, isArray: true })
  audiences!: unknown[];
}
