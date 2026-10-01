import type { ApiProblem } from './problem.ts';

type UnauthenticatedListener = (problem: ApiProblem) => void;

const listeners = new Set<UnauthenticatedListener>();

/** Called on every 401: the web app shows sign-in and the offline outbox pauses. */
export const onUnauthenticated = (listener: UnauthenticatedListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const emitUnauthenticated = (problem: ApiProblem): void => {
  for (const listener of listeners) listener(problem);
};
