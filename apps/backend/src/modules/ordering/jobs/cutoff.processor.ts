import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { OnTick } from '../../../core/scheduling/ticker.service';
import { CutoffCloseService } from '../services/cutoff-close.service';
import { CutoffReminderService } from '../services/cutoff-reminder.service';
import { ORDER_TICKS } from '../ordering.constants';

/**
 * The two things the clock does to orders, run once a minute by the worker's
 * ticker with the demo clock's `now`, so time travel triggers them exactly
 * as a real afternoon would (apps/backend/CLAUDE.md, "Scheduled work").
 *
 * Both handlers are idempotent: a tick that repeats after a crash finds the
 * day already closed, or the outlet already reminded, and does nothing.
 */
@Injectable()
export class CutoffProcessor {
  constructor(
    private readonly closures: CutoffCloseService,
    private readonly reminders: CutoffReminderService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(CutoffProcessor.name);
  }

  /**
   * Confirms every submitted order whose cutoff has passed, one depot day at
   * a time, so a depot with its own earlier cutoff closes earlier
   * (AC-ORD-06, AC-ORD-23, AC-ORD-24).
   */
  @OnTick(ORDER_TICKS.cutoff)
  async closeDueCutoffs(now: Date): Promise<void> {
    const due = await this.closures.due(now);
    for (const day of due)
      await this.closures.close(day.depotId, day.deliveryDate, 'ticker');
  }

  /** The 15:30 nudge to outlets with no order for the next run (AC-ORD-26). */
  @OnTick(ORDER_TICKS.cutoffReminder)
  async remindMissingOrders(now: Date): Promise<void> {
    await this.reminders.remind(now);
  }
}
