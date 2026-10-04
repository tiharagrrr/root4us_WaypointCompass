import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Links } from '@waypoint/shared';

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
