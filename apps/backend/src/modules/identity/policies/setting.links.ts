import { Injectable } from '@nestjs/common';
import { type Actor, can } from '@waypoint/shared';
import { AppConfig } from '../../../config/app-config';
import { ClockService } from '../../../core/clock/clock.service';
import type { Collection } from '../../../core/http/envelope.interceptor';
import { compact } from '../../../core/http/links';
import type { ResolvedSetting } from '../../../core/settings/settings.service';
import { SETTINGS } from '../../../core/settings/settings.registry';
import type { ClockDto, SettingDto } from '../dto/settings.dto';

/** Settings and the demo clock on A6, with what the caller may change. */
@Injectable()
export class SettingLinks {
  constructor(
    private readonly clock: ClockService,
    private readonly config: AppConfig,
  ) {}

  one(s: ResolvedSetting, actor: Actor): SettingDto {
    const def = SETTINGS[s.key];
    const self = `/api/v1/settings/${s.key}${s.depotId ? `?depotId=${s.depotId}` : ''}`;
    const editable = !('managedBy' in def);
    const manage = can(actor, 'settings:manage');
    return {
      key: s.key,
      value: s.value,
      default: def.default,
      source: s.source,
      depotId: s.depotId,
      perDepot: 'perDepot' in def && def.perDepot === true,
      editable,
      description: def.description,
      updatedAt: s.updatedAt ? this.clock.toIso(s.updatedAt) : null,
      _links: compact({
        self: { href: self },
        edit: manage &&
          editable && { href: self, method: 'PUT', title: 'Change' },
        clearOverride: manage &&
          s.source === 'depot' && {
            href: self,
            method: 'DELETE',
            title: 'Use the global value',
          },
        clock: s.key === 'demo.clock' && { href: '/api/v1/clock' },
      }),
    };
  }

  list(
    settings: ResolvedSetting[],
    actor: Actor,
    depotId: string | null,
  ): Collection<SettingDto> {
    const href = `/api/v1/settings${depotId ? `?depotId=${depotId}` : ''}`;
    return {
      items: settings.map((s) => this.one(s, actor)),
      page: { limit: settings.length, offset: 0, total: settings.length },
      links: { self: { href } },
    };
  }

  clockView(actor: Actor): ClockDto {
    const mode = this.clock.mode();
    const demoMode = this.config.demo.enabled === true;
    return {
      mode: mode.mode,
      now: this.clock.toIso(this.clock.now()),
      realNow: this.clock.toIso(this.clock.realNow()),
      at: 'at' in mode ? this.clock.toIso(new Date(mode.at)) : null,
      offsetMs: mode.mode === 'offset' ? mode.offsetMs : null,
      demoMode,
      shifted: demoMode && mode.mode !== 'real',
      _links: compact({
        self: { href: '/api/v1/clock' },
        set: demoMode &&
          can(actor, 'settings:manage') && {
            href: '/api/v1/clock',
            method: 'PUT',
            title: 'Time travel',
          },
        reset: demoMode &&
          can(actor, 'settings:manage') && {
            href: '/api/v1/demo/reset',
            method: 'POST',
            title: 'Reset demo day',
          },
      }),
    };
  }
}
