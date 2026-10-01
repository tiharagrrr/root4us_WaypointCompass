import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { ClsServiceManager } from 'nestjs-cls';
import { stampActor } from '../../db/actor';
import type { Database } from '../../db/client';
import { DB } from '../../db/database.module';
import type { AppClsStore } from '../context/request-context';

/**
 * The transactional adapter for Drizzle, plus one thing: every transaction
 * it opens is stamped for row-level security (src/db/actor.ts) with the
 * actor in the current CLS context, before any other statement runs. A
 * request is stamped as its signed-in actor, a job as the system, and
 * anything else as anonymous, which the policies give no rows. Savepoints
 * (nested transactions) inherit the stamp.
 */
export class StampedDrizzleAdapter extends TransactionalAdapterDrizzleOrm<Database> {
  constructor() {
    super({ drizzleInstanceToken: DB });
    const plain = this.optionsFactory;
    this.optionsFactory = (db) => {
      const options = plain(db);
      return {
        ...options,
        wrapWithTransaction: (txOptions, fn, setClient) => {
          let tx: Database | undefined;
          return options.wrapWithTransaction(
            txOptions,
            async (...args: unknown[]): Promise<unknown> => {
              await stampActor(tx ?? db, currentDbActor());
              return fn(...args);
            },
            (client) => {
              tx = client;
              setClient(client);
            },
          );
        },
      };
    };
  }
}

function currentDbActor() {
  const cls = ClsServiceManager.getClsService<AppClsStore>();
  if (!cls.isActive()) return undefined;
  return cls.get('dbActor') ?? cls.get('actor');
}

/**
 * Services reach the current transaction through
 * `private readonly txHost: TransactionHost<StampedDrizzleAdapter>` and
 * `this.txHost.tx`. Spell the class out: a type alias would emit `Object` as
 * the injection token.
 */
export { TransactionHost };
