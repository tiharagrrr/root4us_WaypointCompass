import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Brand } from '@waypoint/shared';
import { sql } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { ORDER_NO_SEQUENCE, orderNoFor } from '../domain/order-number';

/**
 * Human order numbers, one sequence per brand: WF-0001 for Fresh, WS-0001
 * for Style, WT-0001 for Tech. A Postgres sequence hands them out, so two
 * stores placing an order at the same moment never collide and a rolled-back
 * draft does not leave a hole anyone notices.
 */
@Injectable()
export class OrderNumberService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  async next(brand: Brand): Promise<string> {
    const sequence = ORDER_NO_SEQUENCE[brand];
    const result = await this.txHost.tx.execute<{ nextval: string }>(
      sql`SELECT nextval(${sequence}) AS nextval`,
    );
    const n = Number(result.rows[0]?.nextval);
    if (!Number.isFinite(n))
      throw new Error(`Sequence ${sequence} gave no number`);
    return orderNoFor(brand, n);
  }
}
