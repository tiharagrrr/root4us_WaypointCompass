import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { addDays } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import {
  ApiPaginated,
  ApiProblems,
  RequirePermission,
} from '../../../core/http/decorators';
import { ValidationError } from '../../../core/errors/domain-errors';
import { CalendarDayDto, CalendarRangeQueryDto } from '../dto/reference.dto';
import { plainList } from '../policies/whole-list';
import { CalendarService } from '../services/calendar.service';

/** The widest range one request may ask for, so a date picker can't pull years. */
const MAX_DAYS = 400;

/**
 * The calendar behind every date picker and the cutoff: which business dates
 * the depots operate on, which are holidays, and the festival ramp the
 * forecast uses. A date outside the seeded range simply has no row; callers
 * that need an answer anyway use `nextOperatingDay`, which falls back to
 * Monday to Saturday (AC-MD-10).
 */
@ApiTags('calendar')
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly clock: ClockService,
  ) {}

  @Get()
  @RequirePermission('masterData:read')
  @ApiPaginated(CalendarDayDto)
  @ApiProblems(400)
  @ApiOperation({ summary: 'Calendar days in a range' })
  async list(@Query() query: CalendarRangeQueryDto) {
    const today = this.clock.businessDate();
    const from = query.from ?? today;
    const to = query.to ?? addDays(from, 30);
    if (to < from)
      throw new ValidationError([
        { field: 'to', code: 'after_from', message: 'Set "to" after "from".' },
      ]);
    if (
      Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) >
      MAX_DAYS * 86_400_000
    )
      throw new ValidationError([
        {
          field: 'to',
          code: 'max',
          message: `Ask for at most ${MAX_DAYS} days at a time.`,
        },
      ]);
    const rows = await this.calendar.range(from, to);
    return plainList(rows, `/api/v1/calendar?from=${from}&to=${to}`);
  }
}
