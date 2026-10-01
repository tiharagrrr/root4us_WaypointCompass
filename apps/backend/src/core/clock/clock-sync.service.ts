import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppConfig } from '../../config/app-config';
import type { Database } from '../../db/client';
import { DB } from '../../db/database.module';
import { settings } from '../../db/schema';
import { clockModeSchema } from '../settings/settings.registry';
import { ClockService, type ClockMode } from './clock.service';

/** How often each process re-reads demo.clock: the 5 seconds AC-IDN-53 allows. */
export const CLOCK_SYNC_MS = 5_000;

/**
 * Keeps ClockService in step with the demo.clock setting in every API and
 * worker process. Only in demo mode: otherwise the setting is ignored and
 * the clock follows the wall clock (AC-IDN-56). With no setting stored, the
 * clock keeps whatever DEMO_CLOCK started it at.
 */
@Injectable()
export class ClockSync implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ClockSync.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly clock: ClockService,
    private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.demo.enabled) return;
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch((err: unknown) =>
        this.log.warn({ event: 'core.clock.sync_failed', err }),
      );
    }, CLOCK_SYNC_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Re-reads the stored mode and applies it. */
  async refresh(): Promise<void> {
    const [row] = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.key, 'demo.clock'), eq(settings.scope, 'global')));
    if (!row) return;
    const parsed = clockModeSchema.safeParse(row.value);
    if (parsed.success) this.adopt(parsed.data);
  }

  /** Applies a demo.clock mode to this process; ignored unless DEMO_MODE=true. */
  adopt(mode: ClockMode): void {
    if (!this.config.demo.enabled) return;
    this.clock.set(mode);
  }
}
