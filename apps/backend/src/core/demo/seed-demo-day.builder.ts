import { Injectable, type OnModuleInit } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { rebuildDemoDay } from '../../db/seed/rebuild';
import type { StampedDrizzleAdapter } from '../persistence/transactions';
import { DemoDay, type DemoDayBuilder, type DemoDayResult } from './demo-day';

/**
 * The seeded demo day (ROO-22: S1 at Peliyagoda, an ordinary day at Kandy) for POST /demo/reset:
 * the same rebuild `pnpm db:reset-demo` and the seed run, inside the reset's one transaction. The demo day spans ordering, planning, loading,
 * execution, receipt and fleet rows, so it is one builder from the seed rather than one per module;
 * it reads each depot's snapshot from the database, never the dataset files.
 */
@Injectable()
export class SeedDemoDayBuilder implements DemoDayBuilder, OnModuleInit {
  readonly name = 's1-demo-day';

  constructor(
    private readonly demoDay: DemoDay,
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  onModuleInit(): void {
    this.demoDay.register(this);
  }

  rebuild(days: string[]): Promise<Omit<DemoDayResult, 'builder'>> {
    return rebuildDemoDay(this.txHost.tx, days);
  }
}
