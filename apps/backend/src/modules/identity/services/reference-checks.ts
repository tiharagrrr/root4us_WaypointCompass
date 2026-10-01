import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import type { FieldError } from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { depots, outlets, vehicles } from '../../../db/schema';

/** Ids a user's or an invitation's scope may point at. */
export interface ScopeReferences {
  depotId?: string | null;
  outletId?: string | null;
  vehicleId?: string | null;
}

/**
 * 400 for a depot, outlet or vehicle that doesn't exist, rather than a
 * foreign key 500. Reads master data's tables; writes nothing.
 */
@Injectable()
export class ReferenceChecks {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  async unknown(refs: ScopeReferences): Promise<FieldError[]> {
    const tx = this.txHost.tx;
    const checks = [
      ['depotId', depots, depots.id, 'depot'],
      ['outletId', outlets, outlets.id, 'outlet'],
      ['vehicleId', vehicles, vehicles.id, 'vehicle'],
    ] as const;
    const errors: FieldError[] = [];
    for (const [field, table, idColumn, noun] of checks) {
      const value = refs[field];
      if (value == null) continue;
      if ((await tx.$count(table, eq(idColumn, value))) === 0)
        errors.push({ field, code: 'unknown', message: `No such ${noun}` });
    }
    return errors;
  }
}
