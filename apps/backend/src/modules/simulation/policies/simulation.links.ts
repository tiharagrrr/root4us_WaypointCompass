import { Injectable } from '@nestjs/common';
import { type Actor, can } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import type { Collection } from '../../../core/http/envelope.interceptor';
import { compact } from '../../../core/http/links';
import type { InjectionDto, SimulationDto } from '../dto/simulation.dto';
import type { InjectionRow, RunView } from '../services/simulation.queries';
import { SimulationGate } from './simulation.gate';

const BASE = '/api/v1/simulations';
const DIRECTOR_SETTING = '/api/v1/settings/simulation.aiDirector';

/**
 * A run with what the caller may do next. The collection carries the AI
 * switch: `director` only while the director is on (a model is configured and
 * the setting is on), which is what lets a screen offer an agentic run, and
 * `enableDirector` or `disableDirector` for whoever may change the setting
 * while a model is configured.
 */
@Injectable()
export class SimulationLinks {
  constructor(
    private readonly clock: ClockService,
    private readonly gate: SimulationGate,
  ) {}

  one(run: RunView, actor: Actor): SimulationDto {
    const self = `${BASE}/${run.id}`;
    const may = can(actor, 'simulation:run');
    const action = (
      verb: string,
      title: string,
      ...from: RunView['status'][]
    ) =>
      may &&
      from.includes(run.status) && {
        href: `${self}/${verb}`,
        method: 'POST' as const,
        title,
      };
    return {
      id: run.id,
      scenario: run.scenarioKey,
      status: run.status,
      planId: run.planId,
      depotId: run.depotId,
      planDate: run.planDate,
      seed: run.seed,
      speed: run.speed,
      simStartAt: this.clock.toIso(run.simStartAt),
      simNow: run.simNow ? this.clock.toIso(run.simNow) : null,
      agentic: run.agentic,
      narrative: run.narrative,
      kpis: (run.kpis as Record<string, unknown> | null) ?? null,
      injections: run.injections.map((i) => this.injection(i)),
      createdAt: this.clock.toIso(run.createdAt),
      finishedAt: run.finishedAt ? this.clock.toIso(run.finishedAt) : null,
      _links: compact({
        self: { href: self },
        start: action('start', 'Start', 'DRAFT'),
        pause: action('pause', 'Pause', 'RUNNING'),
        resume: action('resume', 'Resume', 'PAUSED'),
        stop: action('stop', 'Stop', 'RUNNING', 'PAUSED'),
        inject: action(
          'injections',
          'Add trouble',
          'DRAFT',
          'RUNNING',
          'PAUSED',
        ),
        replay: may &&
          run.status === 'COMPLETED' && {
            href: BASE,
            method: 'POST',
            title: 'Replay',
          },
      }),
    };
  }

  injection(row: InjectionRow): InjectionDto {
    return {
      id: row.id,
      kind: row.kind,
      atSim: this.clock.toIso(row.atSim),
      target: row.target as Record<string, unknown>,
      params: (row.params as Record<string, unknown> | null) ?? null,
      proposedBy: row.proposedBy,
      firedAt: row.firedAt ? this.clock.toIso(row.firedAt) : null,
    };
  }

  async list(
    runs: RunView[],
    actor: Actor,
  ): Promise<Collection<SimulationDto>> {
    const may = can(actor, 'simulation:run');
    const manage = can(actor, 'settings:manage') && this.gate.model !== null;
    const on = await this.gate.directorOn();
    return {
      items: runs.map((run) => this.one(run, actor)),
      page: { limit: runs.length, offset: 0, total: runs.length },
      links: compact({
        self: { href: BASE },
        create: may && { href: BASE, method: 'POST', title: 'New simulation' },
        director: may &&
          on && {
            href: BASE,
            method: 'POST',
            title: 'Let the AI director add trouble',
          },
        enableDirector: manage &&
          !on && {
            href: DIRECTOR_SETTING,
            method: 'PUT',
            title: 'Turn on the AI scenario director',
          },
        disableDirector: manage &&
          on && {
            href: DIRECTOR_SETTING,
            method: 'PUT',
            title: 'Turn off the AI scenario director',
          },
      }),
    };
  }
}
