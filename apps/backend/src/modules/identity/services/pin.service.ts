import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, exists, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { AppConfig } from '../../../config/app-config';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { loaderDepots, users } from '../../../db/schema';
import type { Auth } from '../auth/auth';
import { AUTH } from '../auth/auth.module';

/**
 * Loader PINs: 4 digits, hashed with the password hasher, unique among the
 * loaders of each depot a loader works at (home depot or loader_depots), the
 * same set the PIN sign-in checks. While DEMO_MODE=true a copy in clear is kept
 * beside the hash (users.demoPin), so A1 can show the admin the PIN.
 */
@Injectable()
export class PinService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly config: AppConfig,
  ) {}

  /** The two columns a new PIN writes: the hash, and the demo copy or null. */
  async columns(
    pin: string,
  ): Promise<{ pinHash: string; demoPin: string | null }> {
    return {
      pinHash: await this.hash(pin),
      demoPin: this.config.demo.enabled === true ? pin : null,
    };
  }

  async hash(pin: string): Promise<string> {
    return (await this.auth.$context).password.hash(pin);
  }

  /** The loader's home depot and any extra depots, sorted. */
  async depotsOf(user: {
    id: string;
    depotId: string | null;
  }): Promise<string[]> {
    const extra = await this.txHost.tx
      .select({ depotId: loaderDepots.depotId })
      .from(loaderDepots)
      .where(eq(loaderDepots.userId, user.id));
    const all = new Set(extra.map((d) => d.depotId));
    if (user.depotId) all.add(user.depotId);
    return [...all].sort();
  }

  /**
   * Whether another loader at one of these depots already holds the PIN.
   * Takes a transaction lock per depot first, so two admins can't hand out
   * the same PIN at once; call it inside the write's transaction.
   */
  async takenAt(
    depotIds: string[],
    pin: string,
    exceptUserId?: string,
  ): Promise<boolean> {
    const tx = this.txHost.tx;
    for (const depotId of depotIds)
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`loader-pin:${depotId}`}))`,
      );
    const others = await tx
      .select({ pinHash: users.pinHash })
      .from(users)
      .where(
        and(
          eq(users.role, 'loader'),
          isNotNull(users.pinHash),
          exceptUserId ? ne(users.id, exceptUserId) : undefined,
          or(
            inArray(users.depotId, depotIds),
            exists(
              tx
                .select({ one: sql`1` })
                .from(loaderDepots)
                .where(
                  and(
                    eq(loaderDepots.userId, users.id),
                    inArray(loaderDepots.depotId, depotIds),
                  ),
                ),
            ),
          ),
        ),
      );
    const ctx = await this.auth.$context;
    for (const other of others) {
      if (await ctx.password.verify({ hash: other.pinHash!, password: pin }))
        return true;
    }
    return false;
  }
}
