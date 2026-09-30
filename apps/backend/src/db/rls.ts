/**
 * Database roles and row-level security helpers used by the schema files.
 *
 * The app decides who may do what; Postgres independently limits what the
 * running code can touch. Every request runs in one transaction stamped with
 * the actor (see ./actor.ts), and these policies read that stamp back.
 *
 * Keep policy SQL free of JavaScript values: drizzle-kit writes it into the
 * migration verbatim, and column references render as "table"."column".
 */
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { pgRole } from 'drizzle-orm/pg-core';

/** Migrations, the seed and demo reset connect as compass_owner (DIRECT_URL). */
export const OWNER_ROLE = 'compass_owner';
/** The API and the worker connect as compass_app (DATABASE_URL). */
export const appRole = pgRole('compass_app').existing();
/** Grafana and reporting. */
export const readonlyRole = pgRole('compass_readonly').existing();

const role = sql`coalesce(current_setting('app.role', true), '')`;
const userId = sql`current_setting('app.user_id', true)`;
const depot = sql`coalesce(current_setting('app.depot_id', true), '')`;
const outlet = sql`current_setting('app.outlet_id', true)`;

/** OrderScope's rule, enforced a second time by Postgres. No actor stamped means no rows. */
export const orderVisible = (t: {
  id: AnyColumn;
  depotId: AnyColumn;
  outletId: AnyColumn;
}): SQL => sql`(
  ${role} IN ('admin', 'system')
  OR (${role} = 'dispatcher' AND (${depot} = '' OR ${t.depotId} = ${depot}))
  OR (${role} = 'loader' AND ${t.depotId} = ${depot})
  OR (${role} = 'store_manager' AND ${t.outletId} = ${outlet})
  OR (${role} = 'driver' AND EXISTS (SELECT 1 FROM stops s JOIN trips tr ON tr.id = s."tripId"
      WHERE s."orderId" = ${t.id} AND tr."driverId" = ${userId})))`;

/** Child rows follow their order: the orders policy applies inside this subquery too. */
export const viaVisibleOrder = (orderId: AnyColumn): SQL =>
  sql`EXISTS (SELECT 1 FROM orders o WHERE o.id = ${orderId})`;

/** Stores see their outlet's issues, dispatchers their depot's, drivers those on their trips. */
export const issueVisible = (t: {
  outletId: AnyColumn;
  stopId: AnyColumn;
}): SQL => sql`(
  ${role} IN ('admin', 'system')
  OR (${role} = 'dispatcher' AND (${depot} = '' OR EXISTS (SELECT 1 FROM outlets ou
      WHERE ou.id = ${t.outletId} AND ou."depotId" = ${depot})))
  OR (${role} = 'store_manager' AND ${t.outletId} = ${outlet})
  OR (${role} = 'driver' AND EXISTS (SELECT 1 FROM stops s JOIN trips tr ON tr.id = s."tripId"
      WHERE s.id = ${t.stopId} AND tr."driverId" = ${userId})))`;

/** Reporting reads every row of a policy-protected table. */
export const readAll = sql`true`;
