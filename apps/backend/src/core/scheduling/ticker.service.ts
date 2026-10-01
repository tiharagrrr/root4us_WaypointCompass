import { Injectable, type OnModuleInit, SetMetadata } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../clock/clock.service';
import { JobContextRunner } from '../context/job-context';

const ON_TICK = 'waypoint:on-tick';

/**
 * Runs the method once a minute in the worker, with the demo clock's now:
 * `@OnTick('ordering.cutoff') async closeCutoffs(now: Date) { ... }`.
 * Scheduled work asks the clock what is due instead of trusting cron, so
 * time travel triggers it correctly. Each handler runs in its own
 * transaction, stamped as the system; one handler failing does not stop the
 * others. Handlers must be idempotent: a tick can repeat after a crash.
 */
export const OnTick = (name: string) => SetMetadata(ON_TICK, name);

type TickHandler = (now: Date) => unknown;

interface Registered {
  name: string;
  run: TickHandler;
}

/** Finds every @OnTick method at startup and runs them on each tick. */
@Injectable()
export class TickerService implements OnModuleInit {
  private handlers: Registered[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly clock: ClockService,
    private readonly jobs: JobContextRunner,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(TickerService.name);
  }

  onModuleInit(): void {
    this.handlers = this.discovery.getProviders().flatMap((wrapper) => {
      const instance: unknown = wrapper.instance;
      if (
        !instance ||
        typeof instance !== 'object' ||
        !wrapper.isDependencyTreeStatic()
      )
        return [];
      const prototype = Object.getPrototypeOf(instance) as object;
      return this.scanner.getAllMethodNames(prototype).flatMap((method) => {
        const fn = (instance as Record<string, unknown>)[method];
        if (typeof fn !== 'function') return [];
        const name = this.reflector.get<string | undefined>(ON_TICK, fn);
        if (!name) return [];
        return [
          { name, run: (now: Date) => fn.call(instance, now) as unknown },
        ];
      });
    });
  }

  /** The names of the discovered handlers, in run order. */
  names(): string[] {
    return this.handlers.map((h) => h.name);
  }

  /** Runs every handler once with the clock's now; returns the names that failed. */
  async tick(): Promise<string[]> {
    const now = this.clock.now();
    const failed: string[] = [];
    for (const handler of this.handlers) {
      try {
        await this.jobs.run(
          {
            id: `tick:${handler.name}:${now.toISOString()}`,
            bindings: { tick: handler.name },
          },
          async () => {
            await handler.run(now);
          },
        );
      } catch (err: unknown) {
        failed.push(handler.name);
        this.log.error(
          { err, event: 'core.tick.failed', tick: handler.name },
          'tick handler failed',
        );
      }
    }
    return failed;
  }
}
