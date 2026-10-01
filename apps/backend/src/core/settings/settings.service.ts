import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, inArray } from 'drizzle-orm';
import { settings } from '../../db/schema';
import { ClockService } from '../clock/clock.service';
import { NotFoundError, ValidationError } from '../errors/domain-errors';
import type { StampedDrizzleAdapter } from '../persistence/transactions';
import {
  isSettingKey,
  SETTING_KEYS,
  SETTINGS,
  type SettingDefinition,
  type SettingKey,
  type SettingValue,
} from './settings.registry';

export const GLOBAL_SCOPE = 'global';

/** Where a resolved value came from. */
export type SettingSource = 'default' | 'global' | 'depot';

export interface ResolvedSetting {
  key: SettingKey;
  value: unknown;
  source: SettingSource;
  /** The depot the value was resolved for, if any. */
  depotId: string | null;
  updatedAt: Date | null;
}

type Row = typeof settings.$inferSelect;

/**
 * Typed settings (A6). A value resolves from the depot's override (only for
 * keys that allow one), then the global row, then the registry default. A
 * stored value that no longer fits its schema is ignored rather than trusted.
 * Writes go through identity's settings commands, which audit and broadcast.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
  ) {}

  /** The key's definition; 404 for a key nobody registered. */
  definition(key: string): SettingDefinition & { key: SettingKey } {
    if (!isSettingKey(key)) throw new NotFoundError('setting');
    return { key, ...(SETTINGS[key] as SettingDefinition) };
  }

  async get<K extends SettingKey>(
    key: K,
    depotId?: string | null,
  ): Promise<SettingValue<K>> {
    return (await this.resolve(key, depotId)).value as SettingValue<K>;
  }

  async resolve(
    key: string,
    depotId?: string | null,
  ): Promise<ResolvedSetting> {
    const def = this.definition(key);
    const rows = await this.rows([def.key], depotId);
    return this.pick(def.key, rows, depotId ?? null);
  }

  /** Every registered key, resolved for the depot when one is given. */
  async list(depotId?: string | null): Promise<ResolvedSetting[]> {
    const rows = await this.rows(SETTING_KEYS, depotId);
    return SETTING_KEYS.map((key) => this.pick(key, rows, depotId ?? null));
  }

  /** The value as the key's schema parses it, or 400 naming what is wrong. */
  validate(key: string, value: unknown): unknown {
    const parsed = this.definition(key).schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new ValidationError(
      parsed.error.issues.map((issue) => ({
        field: ['value', ...issue.path.map(String)].join('.'),
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  /** Stores a validated value for a scope: GLOBAL_SCOPE or a depot id. */
  async write(
    key: SettingKey,
    value: unknown,
    scope: string,
    updatedById: string | null,
  ): Promise<void> {
    const updatedAt = this.clock.realNow();
    await this.txHost.tx
      .insert(settings)
      .values({ key, scope, value, updatedById, updatedAt })
      .onConflictDoUpdate({
        target: [settings.key, settings.scope],
        set: { value, updatedById, updatedAt },
      });
  }

  /** Removes a depot override; false when there was none. */
  async remove(key: SettingKey, scope: string): Promise<boolean> {
    const gone = await this.txHost.tx
      .delete(settings)
      .where(and(eq(settings.key, key), eq(settings.scope, scope)))
      .returning({ key: settings.key });
    return gone.length > 0;
  }

  private rows(keys: SettingKey[], depotId?: string | null): Promise<Row[]> {
    const scopes = depotId ? [GLOBAL_SCOPE, depotId] : [GLOBAL_SCOPE];
    return this.txHost.tx
      .select()
      .from(settings)
      .where(and(inArray(settings.key, keys), inArray(settings.scope, scopes)));
  }

  private pick(
    key: SettingKey,
    rows: Row[],
    depotId: string | null,
  ): ResolvedSetting {
    const def = SETTINGS[key] as SettingDefinition;
    const valid = (scope: string) => {
      const row = rows.find((r) => r.key === key && r.scope === scope);
      return row && def.schema.safeParse(row.value).success ? row : undefined;
    };
    const override = def.perDepot && depotId ? valid(depotId) : undefined;
    const global = valid(GLOBAL_SCOPE);
    const row = override ?? global;
    return {
      key,
      value: row ? row.value : def.default,
      source: override ? 'depot' : global ? 'global' : 'default',
      depotId,
      updatedAt: row?.updatedAt ?? null,
    };
  }
}
