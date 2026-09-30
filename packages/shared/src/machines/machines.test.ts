import { describe, expect, it } from 'vitest';
import {
  ALERT_STATUSES,
  DEFERRAL_STATUSES,
  INVITATION_STATUSES,
  LOAD_FLAG_STATUSES,
  ORDER_STATUSES,
  PLAN_STATUSES,
  type OrderStatus,
  STOP_STATUSES,
  STORE_RESPONSES,
  TRIP_STATUSES,
} from '../domain';
import {
  alertMachine,
  assertTransition,
  deferralMachine,
  invitationMachine,
  loadFlagMachine,
  orderMachine,
  planMachine,
  stopMachine,
  storeResponseMachine,
  TransitionError,
  tripMachine,
  type Machine,
} from '.';

const machines: [Machine<string, string>, readonly string[]][] = [
  [orderMachine, ORDER_STATUSES],
  [planMachine, PLAN_STATUSES],
  [tripMachine, TRIP_STATUSES],
  [stopMachine, STOP_STATUSES],
  [deferralMachine, DEFERRAL_STATUSES],
  [storeResponseMachine, STORE_RESPONSES],
  [loadFlagMachine, LOAD_FLAG_STATUSES],
  [alertMachine, ALERT_STATUSES],
  [invitationMachine, INVITATION_STATUSES],
];

describe.each(machines.map(([m, s]) => [m.name, m, s] as const))(
  '%s machine',
  (_name, machine, statuses) => {
    it('has a row for every status and only leads to known statuses', () => {
      expect(Object.keys(machine.table).sort()).toEqual([...statuses].sort());
      for (const row of Object.values(machine.table)) {
        for (const to of Object.values(row)) expect(statuses).toContain(to);
      }
    });

    it('reaches every status from the first one', () => {
      const seen = new Set([statuses[0]]);
      const queue = [statuses[0]];
      while (queue.length) {
        const from = queue.shift()!;
        for (const to of Object.values(machine.table[from] ?? {})) {
          if (!seen.has(to)) {
            seen.add(to);
            queue.push(to);
          }
        }
      }
      expect([...seen].sort()).toEqual([...statuses].sort());
    });
  },
);

describe('order machine', () => {
  it('walks the happy path from draft to received', () => {
    let s: OrderStatus = 'DRAFT';
    for (const event of [
      'SUBMIT',
      'CUTOFF',
      'PLAN',
      'LOAD',
      'DEPART',
      'DELIVER',
      'RECEIVE',
    ] as const) {
      s = assertTransition(orderMachine, s, event);
    }
    expect(s).toBe('RECEIVED');
  });

  it('refuses to cancel an order once it is loaded', () => {
    expect(orderMachine.can('LOADED', 'CANCEL')).toBe(false);
    expect(() => assertTransition(orderMachine, 'LOADED', 'CANCEL')).toThrow(
      TransitionError,
    );
  });

  it('lets a failed order be re-queued and a kept delivery stand after deferral', () => {
    expect(orderMachine.next('FAILED', 'REQUEUE')).toBe('CONFIRMED');
    expect(orderMachine.next('DEFERRED', 'DELIVER')).toBe('DELIVERED');
  });

  it('ends in ISSUE_REPORTED or CANCELLED', () => {
    expect([...orderMachine.terminal].sort()).toEqual([
      'CANCELLED',
      'ISSUE_REPORTED',
    ]);
  });
});

describe('trip machine', () => {
  it('sends a released trip moved to another vehicle back to loading', () => {
    expect(tripMachine.next('RELEASED', 'REASSIGN_VEHICLE')).toBe('LOADING');
  });

  it('cannot be cancelled once started', () => {
    expect(tripMachine.can('IN_PROGRESS', 'CANCEL')).toBe(false);
  });
});

describe('TransitionError', () => {
  it('carries the 409 code and a readable message', () => {
    try {
      assertTransition(stopMachine, 'DELIVERED', 'ARRIVE');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TransitionError);
      expect((err as TransitionError).code).toBe('CONFLICT_STATE');
      expect((err as Error).message).toBe(
        'stop: ARRIVE is not allowed from DELIVERED',
      );
    }
  });
});
