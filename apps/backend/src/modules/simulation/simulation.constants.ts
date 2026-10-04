/** specs/simulation/spec.md: scenarios, the director's limits and the names the module emits. */
export const SCENARIOS = ['normal-day'] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** The injections this build carries out; the rest of injection_kind waits for ROO-63. */
export const INJECTION_KINDS = ['ROAD_DELAY', 'FAILED_DELIVERY'] as const;
export type InjectionKind = (typeof INJECTION_KINDS)[number];

export const FAILED_REASONS = ['REFUSED', 'DAMAGED', 'OUTLET_CLOSED'] as const;

/** Simulated seconds per real second. */
export const DEFAULT_SPEED = 60;
/** A run starts this long before its plan's first departure. */
export const LEAD_IN_MINUTES = 10;
/** The leg into a stop when the plan does not say. */
export const DEFAULT_TRAVEL_MINUTES = 15;

/** The director gets a summary every 20 simulated minutes, and 12 tool calls a run. */
export const DIRECTOR_INTERVAL_MINUTES = 20;
export const DIRECTOR_MAX_CALLS = 12;

/** Who signs for a simulated delivery. */
export const RECEIVER_NAMES = [
  'K. Fernando',
  'S. Perera',
  'N. Silva',
  'R. Jayasinghe',
  'M. Wickramasinghe',
  'T. Gunawardena',
] as const;

export const SIMULATION_EVENTS = {
  created: 'simulation.run.created',
  started: 'simulation.run.started',
  paused: 'simulation.run.paused',
  resumed: 'simulation.run.resumed',
  stopped: 'simulation.run.stopped',
  injectionAdded: 'simulation.injection.added',
  injectionFired: 'simulation.injection.fired',
} as const;

export const SIMULATION_LOGS = {
  ...SIMULATION_EVENTS,
  directorTurn: 'simulation.director.turn',
  directorRejected: 'simulation.director.rejected',
  directorFailed: 'simulation.director.failed',
  driverRefused: 'simulation.driver.refused',
  tickFailed: 'simulation.run.tick_failed',
} as const;

/** Fixed: a run never takes a prompt from a person (AC-SIM-10). */
export const DIRECTOR_PROMPT = `You direct trouble for a delivery-day simulation used in a product demo.
Every 20 simulated minutes you get the state of the day as JSON: the simulated time, the trips with their progress, and what has already been injected.
Decide whether one disruption now would make the demo more instructive. Most turns the right call is noop: a day with one or two well-placed problems reads better than chaos.
Call exactly one tool. Use only ids that appear in the state. Leave atSim null to act now, or give a simulated time later than simNow.`;

export const NARRATIVE_PROMPT = `You write the after-action report of a delivery-day simulation for a dispatcher.
You get the run's numbers and injections as JSON. Write three to five plain sentences: what happened, what the trouble cost, and what held up. Use only what the JSON says. No headings, no lists.`;
