import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';

/** Asia/Colombo is UTC+05:30 all year (no daylight saving since 2006). */
const COLOMBO_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;

/**
 * How the demo clock runs. Stored in the demo.clock setting by ROO-27's
 * PUT /clock, which accepts it only when DEMO_MODE=true.
 */
export type ClockMode =
  | { mode: 'real' }
  /** Real time shifted by offsetMs: the clock keeps running. */
  | { mode: 'offset'; offsetMs: number }
  /** Stopped at one instant (ISO 8601 with offset). */
  | { mode: 'frozen'; at: string }
  /** The simulator moves `at` forward as its run plays out. */
  | { mode: 'simulated'; runId: string; at: string };

/**
 * The one source of "now" for business logic (architecture rule 7).
 *
 * - now(): the demo clock, which every cutoff, window and ticker reads.
 * - realNow(): the wall clock, for token and session expiry, audit
 *   recordedAt and idempotency expiry.
 *
 * DEMO_CLOCK starts the clock at that instant when the API boots and lets it
 * run, only when DEMO_MODE=true. set() changes the mode at runtime (tests,
 * the simulator, and PUT /clock).
 */
@Injectable()
export class ClockService {
  private current: ClockMode = { mode: 'real' };

  constructor(config: AppConfig) {
    const { enabled, clock } = config.demo;
    if (!clock) return;
    if (!enabled) {
      new Logger(ClockService.name).warn(
        'DEMO_CLOCK is ignored because DEMO_MODE is not true',
      );
      return;
    }
    this.set({
      mode: 'offset',
      offsetMs: parseInstant(clock).getTime() - Date.now(),
    });
  }

  now(): Date {
    const c = this.current;
    switch (c.mode) {
      case 'real':
        return new Date();
      case 'offset':
        return new Date(Date.now() + c.offsetMs);
      case 'frozen':
      case 'simulated':
        return new Date(c.at);
    }
  }

  realNow(): Date {
    return new Date();
  }

  mode(): ClockMode {
    return { ...this.current };
  }

  set(mode: ClockMode): void {
    if (mode.mode === 'frozen' || mode.mode === 'simulated') {
      parseInstant(mode.at);
    }
    if (mode.mode === 'offset' && !Number.isFinite(mode.offsetMs)) {
      throw new Error(`Not a finite offset: ${mode.offsetMs}`);
    }
    this.current = { ...mode };
  }

  /** Stops the demo clock at an instant (ISO 8601 with offset). */
  freeze(at: string | Date): void {
    const instant = typeof at === 'string' ? parseInstant(at) : new Date(at);
    this.set({ mode: 'frozen', at: instant.toISOString() });
  }

  /** Back to the wall clock. */
  reset(): void {
    this.current = { mode: 'real' };
  }

  /** The Asia/Colombo business date, 'YYYY-MM-DD'. */
  businessDate(at: Date = this.now(), plusDays = 0): string {
    return colombo(at.getTime() + plusDays * DAY_MS).slice(0, 10);
  }

  /** Minutes after midnight in Asia/Colombo: 15:59 is 959. */
  minutesOfDay(at: Date = this.now()): number {
    const local = new Date(at.getTime() + COLOMBO_OFFSET_MIN * 60_000);
    return local.getUTCHours() * 60 + local.getUTCMinutes();
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
