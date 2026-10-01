import { Injectable } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../clock/clock.service';
import { JobContextRunner } from '../../context/job-context';
import { OnTick, TickerService } from '../ticker.service';

const NOW = new Date('2026-10-01T10:30:00Z');
const calls: string[] = [];

@Injectable()
class CutoffJobs {
  @OnTick('ordering.cutoff')
  close(now: Date) {
    calls.push(`cutoff at ${now.toISOString()}`);
  }

  notATick() {
    calls.push('never');
  }
}

@Injectable()
class BrokenJobs {
  @OnTick('tracking.offline')
  check(): Promise<void> {
    return Promise.reject(new Error('boom'));
  }

  @OnTick('ordering.reminder')
  remind() {
    calls.push('reminder');
  }
}

describe('TickerService', () => {
  it('runs every @OnTick handler with the clock time, each in its own job context', async () => {
    const contexts: string[] = [];
    const log = { setContext: jest.fn(), error: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [
        TickerService,
        CutoffJobs,
        BrokenJobs,
        { provide: ClockService, useValue: { now: () => NOW } },
        {
          provide: JobContextRunner,
          useValue: {
            run: (ctx: { id: string }, work: () => Promise<unknown>) => {
              contexts.push(ctx.id);
              return work();
            },
          },
        },
        { provide: PinoLogger, useValue: log },
      ],
    }).compile();
    await moduleRef.init();
    const ticker = moduleRef.get(TickerService);

    expect(ticker.names().sort()).toEqual([
      'ordering.cutoff',
      'ordering.reminder',
      'tracking.offline',
    ]);

    const failed = await ticker.tick();

    expect(failed).toEqual(['tracking.offline']);
    expect(calls.sort()).toEqual([
      'cutoff at 2026-10-01T10:30:00.000Z',
      'reminder',
    ]);
    expect(contexts.sort()).toEqual([
      'tick:ordering.cutoff:2026-10-01T10:30:00.000Z',
      'tick:ordering.reminder:2026-10-01T10:30:00.000Z',
      'tick:tracking.offline:2026-10-01T10:30:00.000Z',
    ]);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'core.tick.failed',
        tick: 'tracking.offline',
      }),
      'tick handler failed',
    );
  });
});
