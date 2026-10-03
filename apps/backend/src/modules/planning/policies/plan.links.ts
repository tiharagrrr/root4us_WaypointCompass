import { Injectable } from '@nestjs/common';
import { type Actor, can, type Link } from '@waypoint/shared';
import { compact } from '../../../core/http/links';
import type { PlanRow } from '../services/plan-context.builder';
import type { PublishCheck } from '../services/publish.policy';

const write = (href: string, title: string): Link => ({
  href,
  method: 'POST',
  title,
  requires: ['If-Match', 'Idempotency-Key'],
});

/**
 * A plan's `_links` (AC-PLN-33). `publish` appears only when publishing would
 * be accepted now: the actor may publish, the plan is a DRAFT, the clock has
 * reached the opening time and nothing blocks it, so the web greys Publish
 * out from the link alone (architecture rule 9). Once published, `edits`
 * saves a revision (AC-PLN-21): the web asks for a reason when its title
 * says so.
 */
@Injectable()
export class PlanLinks {
  links(
    plan: PlanRow,
    actor: Actor,
    check?: PublishCheck,
  ): Record<string, Link> {
    const self = `/api/v1/plans/${plan.id}`;
    const draft = plan.status === 'DRAFT';
    const revising =
      plan.status === 'PUBLISHED' &&
      can(actor, 'plan:build') &&
      can(actor, 'plan:revise');
    const build = (draft && can(actor, 'plan:build')) || revising;
    return compact({
      self: { href: self },
      trips: { href: `${self}/trips` },
      context: { href: `${self}/context` },
      unplanned: { href: `${self}/unplanned` },
      revisions: { href: `${self}/revisions` },
      validate: { href: `${self}/validate`, method: 'POST' },
      engineRuns:
        draft && build && write(`${self}/engine-runs`, 'Auto-suggest'),
      vehicleOptions: build && { href: `${self}/vehicle-options` },
      orderOptions: build && { href: `${self}/order-options` },
      edits:
        build &&
        write(`${self}/edits`, revising ? 'Save as revision' : 'Save changes'),
      suggestFixes: build && { href: `${self}/suggest-fixes`, method: 'POST' },
      decisions:
        draft &&
        can(actor, 'deferral:decide') &&
        write(`${self}/deferrals/decisions`, 'Decide'),
      publishPreview: can(actor, 'plan:publish') && {
        href: `${self}/publish-preview`,
      },
      publish:
        draft &&
        can(actor, 'plan:publish') &&
        check?.open === true &&
        check.blockers.length === 0 &&
        write(`${self}/publish`, 'Publish'),
    });
  }
}
