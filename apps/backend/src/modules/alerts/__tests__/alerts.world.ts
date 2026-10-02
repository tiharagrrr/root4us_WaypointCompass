import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { uuidv7 } from 'uuidv7';
import { signedInAs } from '../../../../test/auth';
import { createTestApp, ownerDatabase } from '../../../../test/create-test-app';
import { depotFixture, outletFixture, suffix } from '../../../../test/fixtures';
import { ClockService } from '../../../core/clock/clock.service';
import { JobContextRunner } from '../../../core/context/job-context';
import type { Database } from '../../../db/client';
import {
  alertEventReceipts,
  alerts,
  auditEvents,
  outboxEvents,
} from '../../../db/schema';
import { AlertEventListener } from '../services/alert-event.listener';
import type { DomainEvent } from '../domain/alert-rules';
import type { HandledEvent } from '../services/alert-event.listener';

/**
 * The world every alerts suite runs in.
 *
 * It is deliberately thin. An alert points at a trip, stop, order, outlet,
 * flag, issue, deferral or conflict **by id, with no foreign key**, precisely
 * so that any module can raise one without alerts knowing anything about it
 * (specs/alerts/spec.md, Model). So these suites hand the listener the ids of
 * things that need not exist: no trip has to be planned, no flag raised and
 * no conflict detected to test what alerts does when it hears about one.
 *
 * What does have to be real is the people, because the permission matrix and
 * the scope are the subject of three criteria: Tihara, a dispatcher over
 * every depot; a second dispatcher scoped to Kandy; and one of each other
 * role, who hold no alert permission at all.
 *
 * Fixture ids carry a random suffix, so each run gets its own depots and its
 * own alerts, and the list criteria can assert exact totals.
 */
export interface World {
  app: NestExpressApplication;
  db: Database;
  close: () => Promise<void>;
  sfx: string;
  depot: { plg: string; kdy: string; plgDistrict: string; kdyDistrict: string };
  /** Fresh Kadawatha, the outlet a store issue is reported for. */
  kadawatha: string;
  as: Record<Role, { id: string; cookie: string }>;
}

export type Role =
  /** Tihara Egodage, dispatcher over every depot. */
  | 'tihara'
  /** A dispatcher scoped to Peliyagoda, who sees this depot and no other. */
  | 'plg'
  /** A dispatcher scoped to Kandy, who must see none of this. */
  | 'kandy'
  | 'loader'
  | 'store'
  | 'driver'
  | 'admin';

export async function buildWorld(): Promise<World> {
  const sfx = suffix();
  const app = await createTestApp();
  const { db, close } = ownerDatabase();
  const depot = await depotFixture(db, sfx);
  const kadawatha = await outletFixture(
    db,
    `OUTK${sfx}`,
    { depotId: depot.plg, districtId: depot.plgDistrict },
    { name: `Fresh Kadawatha ${sfx}` },
  );

  const as = {
    tihara: await signedInAs(app, db, {
      role: 'dispatcher',
      name: 'Tihara Egodage',
      depotId: null,
    }),
    plg: await signedInAs(app, db, {
      role: 'dispatcher',
      name: 'Peliyagoda dispatcher',
      depotId: depot.plg,
    }),
    kandy: await signedInAs(app, db, {
      role: 'dispatcher',
      name: 'Kandy dispatcher',
      depotId: depot.kdy,
    }),
    loader: await signedInAs(app, db, {
      role: 'loader',
      name: 'Harini De Mel',
      depotId: depot.plg,
    }),
    store: await signedInAs(app, db, {
      role: 'store_manager',
      name: 'Nimesha Periyapperuma',
      outletId: kadawatha,
    }),
    driver: await signedInAs(app, db, {
      role: 'driver',
      name: 'Aniqa Razick',
      depotId: depot.plg,
    }),
    admin: await signedInAs(app, db, {
      role: 'admin',
      name: 'Rusiru Withanage',
    }),
  };

  return { app, db, close, sfx, depot, kadawatha, as };
}

export async function closeWorld(world: World): Promise<void> {
  world.app.get(ClockService).reset();
  await world.app.close();
  await world.close();
}

/** A fresh id for something alerts only ever knows by its id. */
export const anId = () => uuidv7();

/**
 * One event, delivered the way the outbox relay (ROO-24) will deliver it: a
 * single row, in a job context stamped as the system, in its own transaction.
 * The clock is moved to `at` first, because an alert's severity and its
 * "minutes open" are both read off the demo clock.
 */
export async function deliver(
  world: World,
  event: Partial<DomainEvent> & { type: string; payload: unknown },
  at?: string,
): Promise<HandledEvent> {
  if (at) world.app.get(ClockService).freeze(at);
  const row: DomainEvent = {
    id: event.id ?? anId(),
    depotId: event.depotId ?? world.depot.plg,
    occurredAt: event.occurredAt ?? world.app.get(ClockService).now(),
    type: event.type,
    payload: event.payload,
  };
  const listener = world.app.get(AlertEventListener);
  return world.app
    .get(JobContextRunner)
    .run({ id: `test:relay:${row.id}` }, () => listener.handle(row));
}

/** Every alert in this world's Peliyagoda depot, in the list's own order. */
export function alertRows(
  world: World,
  dedupeKey?: string,
): Promise<(typeof alerts.$inferSelect)[]> {
  return world.db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.depotId, world.depot.plg),
        dedupeKey ? eq(alerts.dedupeKey, dedupeKey) : undefined,
      ),
    )
    .orderBy(asc(alerts.status), asc(alerts.severity), asc(alerts.id));
}

/** The one alert for a dedupe key, failing the test when there is not exactly one. */
export async function oneAlert(
  world: World,
  dedupeKey: string,
): Promise<typeof alerts.$inferSelect> {
  const rows = await alertRows(world, dedupeKey);
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** The outbox events of a type in this world's depot, for the "once" checks. */
export function outboxRows(
  world: World,
  type: string,
  aggregateId?: string,
): Promise<(typeof outboxEvents.$inferSelect)[]> {
  return world.db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.type, type),
        eq(outboxEvents.depotId, world.depot.plg),
        aggregateId ? eq(outboxEvents.aggregateId, aggregateId) : undefined,
      ),
    )
    .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id));
}

/** Audit rows for an action, limited to this world's alerts. */
export async function auditRows(
  world: World,
  action: string,
  entityId?: string,
): Promise<(typeof auditEvents.$inferSelect)[]> {
  const ours = await world.db
    .select({ id: alerts.id })
    .from(alerts)
    .where(eq(alerts.depotId, world.depot.plg));
  const ids = ours.map((row) => row.id);
  if (ids.length === 0) return [];
  return world.db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, action),
        entityId
          ? eq(auditEvents.entityId, entityId)
          : inArray(auditEvents.entityId, ids),
      ),
    )
    .orderBy(asc(auditEvents.seq));
}

/** Whether the listener recorded a receipt for an event id (AC-ALR-10). */
export async function receiptCount(
  world: World,
  eventId: string,
): Promise<number> {
  const rows = await world.db
    .select({ eventId: alertEventReceipts.eventId })
    .from(alertEventReceipts)
    .where(eq(alertEventReceipts.eventId, eventId));
  return rows.length;
}

/** The structured part of one log line: `{ event, ...ids }`. */
export type LogLine = Record<string, unknown>;

export interface CapturedLogs {
  /** Lines whose `event` matches, oldest first. */
  withEvent: (event: string) => LogLine[];
  restore: () => void;
}

/**
 * Captures what the module logs, so a criterion naming a log line and the
 * fields it carries can assert them (AC-ALR-01, AC-ALR-03, AC-ALR-10).
 *
 * The spy is on `PinoLogger.prototype`, not on the logger's output: every
 * service logs through `this.log.info({ event, ...ids }, message)`, so this
 * sees exactly the object the code passed, whatever pino is configured to do
 * with it. Call `restore()` in afterEach, or the spy outlives the test.
 */
export function captureLogs(): CapturedLogs {
  const lines: LogLine[] = [];
  const spies = (['info', 'warn', 'debug'] as const).map((level) =>
    jest
      .spyOn(PinoLogger.prototype, level)
      .mockImplementation((...args: unknown[]) => {
        const [first] = args;
        if (first && typeof first === 'object') lines.push(first as LogLine);
      }),
  );
  return {
    withEvent: (event) => lines.filter((line) => line.event === event),
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}
