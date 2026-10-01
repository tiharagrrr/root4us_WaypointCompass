import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { PinoLogger } from 'nestjs-pino';
import {
  NotFoundError,
  StateConflictError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import {
  GLOBAL_SCOPE,
  type ResolvedSetting,
  SettingsService,
} from '../../../core/settings/settings.service';
import { AuditService } from '../../audit';
import { ReferenceChecks } from './reference-checks';

/** settings.changed: clients refetch the key; routed to the depot for an override. */
export type SettingsChangedEvent = {
  v: 1;
  key: string;
  depotId: string | null;
};

const MANAGED_ELSEWHERE = {
  clock: 'Set the demo clock with PUT /clock.',
  code: 'This setting is set by the system, not on A6.',
} as const;

/** A6 setting changes: validated by the key's schema, audited and broadcast. */
@Injectable()
export class SettingsCommands {
  constructor(
    private readonly settings: SettingsService,
    private readonly references: ReferenceChecks,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(SettingsCommands.name);
  }

  /**
   * Sets the global value, or a depot's override when depotId is given and
   * the key allows one (AC-IDN-50, 51, 52).
   */
  @Transactional()
  async set(
    key: string,
    value: unknown,
    depotId: string | null,
    actor: Actor,
  ): Promise<ResolvedSetting> {
    const def = this.settings.definition(key);
    if (def.managedBy)
      throw new StateConflictError(MANAGED_ELSEWHERE[def.managedBy]);
    await this.checkDepot(def.perDepot === true, depotId);
    const parsed = this.settings.validate(key, value);

    const before = await this.settings.resolve(key, depotId);
    await this.settings.write(
      def.key,
      parsed,
      depotId ?? GLOBAL_SCOPE,
      actor.id,
    );
    await this.recordChange(key, depotId, before, parsed);
    return this.settings.resolve(key, depotId);
  }

  /** Removes a depot's override, so the depot follows the global value again. */
  @Transactional()
  async clearOverride(key: string, depotId: string): Promise<ResolvedSetting> {
    const def = this.settings.definition(key);
    await this.checkDepot(def.perDepot === true, depotId);
    const before = await this.settings.resolve(key, depotId);
    if (!(await this.settings.remove(def.key, depotId)))
      throw new NotFoundError('setting override');
    const after = await this.settings.resolve(key, depotId);
    await this.recordChange(key, depotId, before, after.value);
    return after;
  }

  private async checkDepot(perDepot: boolean, depotId: string | null) {
    if (!depotId) return;
    if (!perDepot)
      throw new ValidationError([
        {
          field: 'depotId',
          code: 'not_allowed',
          message: 'This setting has no depot override',
        },
      ]);
    const errors = await this.references.unknown({ depotId });
    if (errors.length) throw new ValidationError(errors);
  }

  private async recordChange(
    key: string,
    depotId: string | null,
    before: ResolvedSetting,
    value: unknown,
  ) {
    const entityId = depotId ? `${key}@${depotId}` : key;
    await this.audit.record({
      action: 'core.setting.changed',
      entity: ['setting', entityId],
      before: { value: before.value, source: before.source },
      after: { value },
    });
    const payload: SettingsChangedEvent = { v: 1, key, depotId };
    await this.outbox.add('settings.changed', payload, {
      aggregate: ['setting', key],
      depotId,
    });
    this.log.info(
      { event: 'core.setting.changed', key, depotId },
      'setting changed',
    );
  }
}
