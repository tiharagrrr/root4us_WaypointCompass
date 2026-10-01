import { Injectable, NotImplementedException } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../../config/app-config';
import { ClockSync } from '../../../core/clock/clock-sync.service';
import {
  type ClockMode,
  ClockService,
} from '../../../core/clock/clock.service';
import { DemoDay, type DemoDayResult } from '../../../core/demo/demo-day';
import { DemoInbox } from '../../../core/demo/demo-inbox';
import {
  NotFoundError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import {
  GLOBAL_SCOPE,
  SettingsService,
} from '../../../core/settings/settings.service';
import { AuditService } from '../../audit';
import type { SetClockDto } from '../dto/settings.dto';

export type ClockChangedEvent = { v: 1; mode: ClockMode['mode'] };
export type DemoResetEvent = { v: 1; days: string[] };

/**
 * A6's demo tools: time travel and the demo-day reset. Both exist only when
 * DEMO_MODE=true; otherwise they answer 404, as if they did not exist.
 */
@Injectable()
export class DemoCommands {
  constructor(
    private readonly config: AppConfig,
    private readonly clock: ClockService,
    private readonly clockSync: ClockSync,
    private readonly settings: SettingsService,
    private readonly demoDay: DemoDay,
    private readonly inbox: DemoInbox,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(DemoCommands.name);
  }

  /**
   * Stores the mode in demo.clock and applies it here at once; every other
   * process picks it up within 5 seconds (ClockSync). AC-IDN-53 to 56.
   */
  @Transactional()
  async setClock(dto: SetClockDto, actor: Actor): Promise<ClockMode> {
    this.requireDemoMode('demo clock');
    const before = this.clock.mode();
    const mode = this.toMode(dto);
    await this.settings.write('demo.clock', mode, GLOBAL_SCOPE, actor.id);
    await this.audit.record({
      action: 'core.clock.changed',
      entity: ['setting', 'demo.clock'],
      before,
      after: mode,
    });
    const payload: ClockChangedEvent = { v: 1, mode: mode.mode };
    await this.outbox.add('clock.changed', payload, {
      aggregate: ['setting', 'demo.clock'],
    });
    this.clockSync.adopt(mode);
    this.log.info(
      { event: 'core.clock.changed', mode: mode.mode },
      'demo clock changed',
    );
    return mode;
  }

  /**
   * Rebuilds the seed-sourced rows of the days around demo day D (the day
   * after the demo clock's business date) and empties the demo inbox
   * (AC-IDN-59). Answers 501 until the S1 seed registers a builder.
   */
  @Transactional()
  async resetDemoDay(): Promise<{ days: string[]; rebuilt: DemoDayResult[] }> {
    this.requireDemoMode('demo reset');
    if (!this.demoDay.all.length)
      throw new NotImplementedException(
        'Rebuilding the demo day needs the S1 demo-day seed (ROO-22).',
      );
    const now = this.clock.now();
    const days = [0, 1, 2].map((plus) => this.clock.businessDate(now, plus));
    const rebuilt: DemoDayResult[] = [];
    for (const builder of this.demoDay.all)
      rebuilt.push({ builder: builder.name, ...(await builder.rebuild(days)) });
    await this.inbox.clear();

    await this.audit.record({
      action: 'core.demo.reset',
      entity: ['demo-day', days[1]],
      after: { days, rebuilt },
    });
    const payload: DemoResetEvent = { v: 1, days };
    await this.outbox.add('demo.reset', payload, {
      aggregate: ['demo-day', days[1]],
    });
    this.log.info({ event: 'demo.reset', days }, 'demo day rebuilt');
    return { days, rebuilt };
  }

  private requireDemoMode(what: string): void {
    if (!this.config.demo.enabled) throw new NotFoundError(what);
  }

  private toMode(dto: SetClockDto): ClockMode {
    const missing = (field: string) =>
      new ValidationError([
        {
          field,
          code: 'required',
          message: `Give ${field} for the ${dto.mode} mode`,
        },
      ]);
    switch (dto.mode) {
      case 'real':
        return { mode: 'real' };
      case 'frozen':
        if (!dto.at) throw missing('at');
        return { mode: 'frozen', at: this.clock.toIso(new Date(dto.at)) };
      case 'offset':
        if (dto.offsetMs !== undefined)
          return { mode: 'offset', offsetMs: dto.offsetMs };
        if (!dto.at) throw missing('offsetMs');
        return {
          mode: 'offset',
          offsetMs: Date.parse(dto.at) - this.clock.realNow().getTime(),
        };
    }
  }
}
