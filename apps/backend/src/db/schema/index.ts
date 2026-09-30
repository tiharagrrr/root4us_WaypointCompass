// apps/backend/src/db/schema/index.ts: the barrel drizzle-kit and drizzle() both read.
// A module edits only its own file; see docs/data-model.md for owners.
export * from './enums';
export * from './identity';
export * from './master-data';
export * from './fleet';
export * from './ordering';
export * from './planning';
export * from './loading';
export * from './execution';
export * from './sync';
export * from './receipt';
export * from './alerts';
export * from './audit';
export * from './platform';
export * from './notifications';
export * from './webhooks';
export * from './forecasting';
export * from './simulation';
export * from './relations';
