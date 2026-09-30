// apps/backend/src/db/schema/simulation.ts · owner: simulation
// A deterministic simulator drives the demo through the public APIs; injections are the
// scripted disruptions (breakdown, driver offline, road delay, ...).
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, pk } from '../columns';
import { injectionKindEnum, simulationStatusEnum } from './enums';

export const simulationRuns = pgTable('simulation_runs', {
  id: pk(),
  scenarioKey: text().notNull(), // normal-day | reefer-breakdown | driver-offline | agent
  status: simulationStatusEnum().notNull().default('DRAFT'),
  planId: uuid(),
  seed: integer().notNull(),
  speed: doublePrecision().notNull().default(60), // simulated seconds per real second
  simStartAt: instant().notNull(),
  simNow: instant(),
  agentic: boolean().notNull().default(false),
  prompt: text(), // scenario director prompt
  narrative: text(), // after-action report
  kpis: jsonb(),
  createdById: text().notNull(),
  createdAt: createdAt(),
  finishedAt: instant(),
});

export const simulationInjections = pgTable(
  'simulation_injections',
  {
    id: pk(),
    runId: uuid()
      .notNull()
      .references(() => simulationRuns.id, { onDelete: 'cascade' }),
    kind: injectionKindEnum().notNull(),
    atSim: instant().notNull(), // simulated time to fire
    target: jsonb().notNull(), // { vehicleId } | { tripId } | { districtId }
    params: jsonb(),
    proposedBy: text().notNull().default('human'), // human | agent
    firedAt: instant(),
    outcome: jsonb(),
  },
  (t) => [index('injections_run_time_idx').on(t.runId, t.atSim)],
);
