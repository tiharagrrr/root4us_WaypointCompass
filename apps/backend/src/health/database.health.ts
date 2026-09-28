import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly health: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'database') {
    const indicator = this.health.check(key);
    try {
      await this.pool.query('SELECT 1');
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }
}
