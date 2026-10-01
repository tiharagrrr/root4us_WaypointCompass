/**
 * @compass/api-client: generated TanStack Query hooks and types for the Compass API, plus the
 * hand-written fetch they share. Regenerate with `pnpm api:gen`; never edit src/gen.
 */
export * from './gen/endpoints/index.ts';
export * from './gen/model/index.ts';

export { compassFetch } from './mutator.ts';
export type { BodyType, ErrorType } from './mutator.ts';
export { ApiProblem, codeForStatus, isApiProblem } from './problem.ts';
export type { FieldError, Problem } from './problem.ts';
export { serverClock, syncServerClock, resetServerClock } from './server-clock.ts';
export type { ServerClockSnapshot } from './server-clock.ts';
export { onUnauthenticated } from './auth-events.ts';
export { apiConfig, configureApi } from './config.ts';
export type { ApiConfig } from './config.ts';
export { getDeviceId } from './device-id.ts';
