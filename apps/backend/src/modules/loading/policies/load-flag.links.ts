import { Injectable } from '@nestjs/common';
import { type Actor, can, loadFlagMachine } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { LoadFlagDto } from '../dto/load-list.dto';
import type { LoadFlagRow } from '../services/loading.queries';

const BASE = '/api/v1/load-flags';

/**
 * A flag with the actions allowed right now: the affordance rule
 * (specs/api-conventions.md, section 2) applied to the L3a–L3c loop.
 *
 * Three gates, and a link appears only when all three pass:
 *
 * 1. **The flag machine.** `undo` while nobody has answered, `decide` while
 *    it is OPEN, `recheck` only once a REPLACE has sent the loader back. A
 *    RESOLVED flag offers nothing at all (AC-LOD-09, AC-LOD-10, AC-LOD-11).
 * 2. **The permission.** `load:flag` for undo, `load:decide` for the
 *    decision, `load:check` for the re-check — so Harini's view of her own
 *    flag has `undo` and no `decide`, and Tihara's has `decide` and no
 *    `undo`, from the same row (AC-LOD-07).
 * 3. **Who raised it.** Undo belongs to the loader who raised the flag.
 *    Another loader on another tablet gets no undo link, and the service
 *    refuses them too.
 *
 * The scope is the fourth gate and is already closed by the time a row gets
 * here: `LoadScope` answers 404 for another depot's flag, so there is no
 * viewer to render links for.
 */
@Injectable()
export class LoadFlagLinks extends LinkBuilder<
  LoadFlagRow,
  Omit<LoadFlagDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(flag: LoadFlagRow) {
    return `${BASE}/${flag.id}`;
  }

  protected actions(flag: LoadFlagRow, actor: Actor): LinkMap {
    const self = this.self(flag);
    const mine = !flag.raisedByUserId || flag.raisedByUserId === actor.id;
    return {
      trip: { href: `/api/v1/trips/${flag.tripId}` },
      loadList: { href: `/api/v1/trips/${flag.tripId}/load-list` },
      comments: { href: `${self}/comments` },
      undo: mine &&
        can(actor, 'load:flag') &&
        loadFlagMachine.can(flag.status, 'UNDO') && {
          href: `${self}/undo`,
          method: 'POST',
          title: 'Undo the flag',
        },
      decide: can(actor, 'load:decide') &&
        loadFlagMachine.can(flag.status, 'REPLACE') && {
          href: `${self}/decision`,
          method: 'POST',
          title: 'Decide the flag',
          // A REMOVE needs a reason the store can be told (AC-LOD-08).
          requires: ['decision', 'reasonCode'],
        },
      recheck: can(actor, 'load:check') &&
        loadFlagMachine.can(flag.status, 'RECHECK') && {
          href: `${self}/recheck`,
          method: 'POST',
          title: 'Re-check the item',
          requires: ['qtyLoaded', 'checkedByName', 'clientUuid'],
        },
    };
  }

  protected present(flag: LoadFlagRow): Omit<LoadFlagDto, '_links'> {
    const iso = (at: Date | null) => (at ? this.clock.toIso(at) : null);
    return {
      id: flag.id,
      tripId: flag.tripId,
      loadLineId: flag.loadLineId,
      reason: flag.reason,
      qtyAffected: flag.qtyAffected,
      note: flag.note,
      status: flag.status,
      decision: flag.decision,
      decisionNote: flag.decisionNote,
      decidedById: flag.decidedById,
      decidedAt: iso(flag.decidedAt),
      raisedByName: flag.raisedByName,
      raisedByUserId: flag.raisedByUserId,
      raisedAt: this.clock.toIso(flag.raisedAt),
      resolvedAt: iso(flag.resolvedAt),
    };
  }
}
