import { Injectable } from '@nestjs/common';

/** What one builder did to a demo day. */
export interface DemoDayResult {
  builder: string;
  deleted: number;
  created: number;
}

/**
 * Rebuilds one module's seed-sourced rows for the given business dates
 * (YYYY-MM-DD), inside the reset's transaction. Rows not from the seed and
 * rows outside those days stay untouched; audit_events is never touched.
 */
export interface DemoDayBuilder {
  readonly name: string;
  rebuild(days: string[]): Promise<Omit<DemoDayResult, 'builder'>>;
}

/**
 * The builders POST /demo/reset runs. The S1 demo-day seed (ROO-22)
 * registers one from the module that owns the rows, in onModuleInit:
 * `demoDay.register(this)`. Until one exists the reset answers 501.
 */
@Injectable()
export class DemoDay {
  private readonly builders: DemoDayBuilder[] = [];

  register(builder: DemoDayBuilder): void {
    this.builders.push(builder);
  }

  get all(): readonly DemoDayBuilder[] {
    return this.builders;
  }
}
