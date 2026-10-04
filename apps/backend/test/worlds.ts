/**
 * The e2e worlds other modules' suites may build on. A module's tests may not reach into another
 * module's folder (scripts/check-module-deps.ts treats __tests__ like any other code), so a suite
 * that needs, say, execution's seeded trips imports them from here:
 *   import { execution } from '../../../../test/worlds';
 */
export * as execution from '../src/modules/execution/__tests__/execution.world';
export * as loading from '../src/modules/loading/__tests__/loading.world';
