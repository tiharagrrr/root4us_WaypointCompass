import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Asia/Colombo is UTC+05:30 all year (no daylight saving since 2006). */
const COLOMBO_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;

/**
 * The one source of "now" for business logic (architecture rule 7).
 *
 * - now(): the demo clock. DEMO_CLOCK starts it at that instant when the API
 *   boots and lets it run; freeze() stops it (tests, and A6 time travel later).
 * - realNow(): the wall clock, for token and session expiry.
 *
 * The demo.clock setting and PUT /clock (modes real, offset, frozen,
 * simulated) arrive with ROO-27 and replace DEMO_CLOCK.
 */
@Injectable()
export class ClockService {
  private offsetMs = 0;
  private frozenAt: Date | null = null;

  constructor(config: ConfigService) {
    const start = config.get<string>('DEMO_CLOCK');
    if (start) this.offsetMs = parseInstant(start).getTime() - Date.now();
  }

  now(): Date {
    return this.frozenAt
      ? new Date(this.frozenAt)
      : new Date(Date.now() + this.offsetMs);
  }

  realNow(): Date {
    return new Date();
  }

  /** Stops the demo clock at an instant (ISO 8601 with offset). */
  freeze(at: string | Date): void {
    this.frozenAt = typeof at === 'string' ? parseInstant(at) : new Date(at);
  }

  /** Back to the wall clock. */
  reset(): void {
    this.frozenAt = null;
    this.offsetMs = 0;
  }

  /** The Asia/Colombo business date, 'YYYY-MM-DD'. */
  businessDate(at: Date = this.now(), plusDays = 0): string {
    return colombo(at.getTime() + plusDays * DAY_MS).slice(0, 10);
  }

  /** An instant as Asia/Colombo ISO 8601: 2026-10-01T15:12:00+05:30. */
  toIso(at: Date): string {
    return `${colombo(at.getTime()).slice(0, 19)}+05:30`;
  }
}

function colombo(ms: number): string {
  return new Date(ms + COLOMBO_OFFSET_MIN * 60_000).toISOString();
}

function parseInstant(value: string): Date {
  const at = new Date(value);
  if (Number.isNaN(at.getTime()))
    throw new Error(`Not an ISO 8601 instant: ${value}`);
  return at;
}
