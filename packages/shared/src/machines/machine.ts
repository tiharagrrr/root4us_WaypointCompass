/**
 * A state machine is a transition table: state -> event -> next state.
 * The same table drives three things: assertTransition() in services, the
 * `_links` a resource advertises, and the status chips in the UI.
 */

export type TransitionTable<S extends string, E extends string> = {
  readonly [K in S]: Readonly<Partial<Record<E, S>>>;
};

export interface Machine<S extends string, E extends string> {
  readonly name: string;
  readonly table: TransitionTable<S, E>;
  /** True when `event` is allowed from `from`. */
  can(from: S, event: E): boolean;
  /** The state `event` leads to from `from`, or undefined if not allowed. */
  next(from: S, event: E): S | undefined;
  /** Every event allowed from `from`, in table order. */
  events(from: S): E[];
  /** States with no way out. */
  readonly terminal: readonly S[];
}

export function defineMachine<S extends string, E extends string>(
  name: string,
  table: TransitionTable<S, E>,
): Machine<S, E> {
  const next = (from: S, event: E): S | undefined => table[from]?.[event];
  const states = Object.keys(table) as S[];
  return {
    name,
    table,
    can: (from, event) => next(from, event) !== undefined,
    next,
    events: (from) => Object.keys(table[from] ?? {}) as E[],
    terminal: states.filter((s) => Object.keys(table[s]).length === 0),
  };
}

/** Thrown when an event is not allowed; the API maps it to 409 CONFLICT_STATE. */
export class TransitionError extends Error {
  readonly code = 'CONFLICT_STATE';

  constructor(
    readonly machine: string,
    readonly from: string,
    readonly event: string,
  ) {
    super(`${machine}: ${event} is not allowed from ${from}`);
    this.name = 'TransitionError';
  }
}

/** Returns the next state, or throws TransitionError. */
export function assertTransition<S extends string, E extends string>(
  machine: Machine<S, E>,
  from: S,
  event: E,
): S {
  const to = machine.next(from, event);
  if (to === undefined) throw new TransitionError(machine.name, from, event);
  return to;
}
