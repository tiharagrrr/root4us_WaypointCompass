---
module: simulation
owner: Aniqa
status: draft          # draft | ready | in-progress | done
screens: []
depends-on: [planning, execution, fleet]
---

# Simulation

## Purpose
The simulator drives a whole delivery day through the real APIs, so the demo shows trucks moving, stops
completing and trouble arriving on cue. The same seed replays the same day every time. The simulator is
core. The agentic scenario director on top of it is a stretch goal, off by default behind
`LLM_PROVIDER`.

## Scope
In:
- Simulation runs: create, start, pause, resume, stop, status, simulated time and KPIs.
- The simulated clock: a run switches `ClockService` to simulated mode, 60× by default.
- One seeded generator (mulberry32) for all randomness: ±10% travel noise, service-time noise and GPS
  jitter.
- Virtual drivers, one per released trip, and optional virtual loaders.
- Scenarios: normal-day, reefer-breakdown, driver-offline, monsoon-kandy and store-dispute.
- Live injections (`POST /simulations/{id}/injections`).
- The end-of-run KPIs and the template narrative.
- Stretch: the agentic scenario director (Claude through the `LlmProvider` port), which proposes
  injections and writes the after-action narrative.

Out:
- What field events and pings do (stops, ETAs, alerts): execution, sync and alerts, through the same
  endpoints a phone uses.
- Clock modes other than simulated (real, offset, frozen) and `clock.changed`: core `ClockService`, with
  the A6 Time travel card in identity.
- `POST /demo/reset`, which rebuilds the demo day (D−1 to D+1): seed and admin tooling (Step 1).
- Plan repair, reassignment and revisions triggered by a breakdown: planning.
- Store receipt and issues in store-dispute: receipt.
- The `LlmProvider` port and its Anthropic adapter: core providers (provider-adapter skill).
- The explain-this-plan panel on 09 and 17: planning.
- The Flutter driver app: after 4 October, not part of the hackathon build.

## Model
Schema file: `apps/backend/src/db/schema/simulation.ts` (owner simulation).

| Table | Key columns | Invariants |
| --- | --- | --- |
| simulation_runs | id, scenarioKey, status (DRAFT, RUNNING, PAUSED, COMPLETED, FAILED), planId, seed, speed (simulated seconds per real second, default 60), simStartAt, simNow, agentic, prompt (director prompt), narrative (after-action report), kpis (jsonb), createdById, createdAt, finishedAt | The seed and plan are fixed for the run. The director prompt is fixed. |
| simulation_injections | id, runId (cascade delete), kind, atSim (simulated time to fire), target (jsonb: vehicleId, tripId or districtId), params (jsonb), proposedBy (human or agent, default human), firedAt, outcome (jsonb) | An agent's injection is stored and carried out exactly like a person's. Index (runId, atSim). |

Enum injection_kind: VEHICLE_BREAKDOWN, DRIVER_OFFLINE, ROAD_DELAY, FAILED_DELIVERY, LOAD_SHORTFALL,
STORE_ISSUE, DEMAND_SPIKE.

Scenarios:

| Scenario | What happens | What it shows |
| --- | --- | --- |
| `normal-day` | Every trip runs to plan with small delays | Tracking, ETAs, store notifications, receipts |
| `reefer-breakdown` | REF-07 breaks down at 04:40, before its second trip | The alert, a repair run, reassigning, revision notices |
| `driver-offline` | VAN-03 loses signal for 40 minutes, records two deliveries offline and syncs late, while one of its stops was deferred | "No signal since", Synced late badges, the 19c conflict |
| `monsoon-kandy` | Kandy's speed index drops to 55 with a road disruption | Late-risk alerts and a re-sequence |
| `store-dispute` | A store confirms receipt with 3 damaged trays | M5 and M6, the alert, resolution, the order timeline |

## Endpoints
| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | /simulations | simulation:run | Scenario, plan, seed and speed; 201 with Location |
| POST | /simulations/{id}/start | simulation:run | Switches `ClockService` to simulated mode for the run |
| POST | /simulations/{id}/pause | simulation:run | Holds simulated time |
| POST | /simulations/{id}/resume | simulation:run | Continues simulated time |
| POST | /simulations/{id}/stop | simulation:run | Ends the run and computes the KPIs |
| POST | /simulations/{id}/injections | simulation:run | Adds trouble live |
| GET | /simulations/{id} | simulation:run | Status, simulated time and KPIs |

The module runs in the worker (`modules/simulation`) and only when `SIMULATION_ENABLED=true` and
`DEMO_MODE=true`.

## Services and helpers
- Run commands: create, start, pause, resume, stop. Start sets the `demo.clock` mode to
  `{ mode: 'simulated', runId }`.
- Seeded generator: mulberry32, one per run, feeding travel noise (±10%), service-time noise and GPS
  jitter. No `Math.random` or `Date.now` in simulation logic.
- Virtual driver: one per released trip. It starts at the planned departure, sends pings along the route
  (district centroid to outlet, timed from the district's travel minutes and the hour's traffic index),
  then arrives and delivers, with receiver names from a fixed list. It uses `POST /sync` and
  `POST /telematics/pings` like a phone, with `source: simulator` on pings and `SIMULATION` as the audit
  source.
- Virtual loader (optional): checks lines and releases trips at each wave's time.
- Injection scheduler: fires each injection when simulated time reaches its atSim, sets firedAt and
  records the outcome.
- KPIs at the end: on-time percentage, stops delivered and failed, deferrals, km, litres, alerts raised
  and time to resolve them.
- Narrative: a template writes `simulation_runs.narrative` when no model is configured.

Stretch, the agentic scenario director:
1. Every 20 simulated minutes the worker sends the director a compact summary: simulated time, trips
   running with their slack, open alerts, and what has already been injected.
2. The director may call at most one tool per turn, and at most 12 in a run.
3. Each call becomes a SimulationInjection with `proposedBy: "agent"`, carried out exactly as a person's.
4. At the end the director gets the KPIs and event list and writes a short narrative into
   `SimulationRun.narrative`. Without a model, the template writes it.

| Tool | Effect |
| --- | --- |
| `inject_breakdown(vehicleId, atSim)` | The vehicle breaks down at that time |
| `inject_driver_offline(tripId, minutes)` | The phone stops syncing and sending pings |
| `inject_road_delay(districtId, speedIndex, minutes)` | Traffic slows in one district |
| `inject_failed_delivery(stopId, reason)` | The next arrival there fails |
| `inject_store_issue(orderId, type)` | The store reports a problem on receipt |
| `noop(reason)` | Let the day run |

Guardrails: injections must be in the simulated future and on the simulation's own plan; the director
has no route to real endpoints; the prompt is fixed; the call budget is hard. Provider: the `LlmProvider`
port with an Anthropic adapter, behind `LLM_PROVIDER=disabled` by default.

## Events
Emits: `simulation.*` (Step 2 boundaries). The doc names no individual event or payload.

Consumes: none. A run's clock change reaches clients as core's `clock.changed`.

## Log events
The doc names none (see Open questions).

## Permissions
| Permission | Roles holding it | Used for |
| --- | --- | --- |
| `simulation:run` | admin, dispatcher | Every simulation endpoint |

Store managers, loaders and drivers do not hold `simulation:run` and get 403.

## Acceptance criteria
- [ ] AC-SIM-01 Runs only in demo mode, for simulation:run
- [ ] AC-SIM-02 Create and start a run
- [ ] AC-SIM-03 Same seed, same day
- [ ] AC-SIM-04 Virtual drivers use the real endpoints
- [ ] AC-SIM-05 The driver-offline scenario reaches 19c
- [ ] AC-SIM-06 The reefer-breakdown scenario raises the alert
- [ ] AC-SIM-07 Trouble added live fires on time
- [ ] AC-SIM-08 A stopped run reports its KPIs
- [ ] AC-SIM-09 (stretch) Director decisions are ordinary injections
- [ ] AC-SIM-10 (stretch) The director stays inside its guardrails

```gherkin
AC-SIM-01  Runs only in demo mode, for simulation:run
  Given DEMO_MODE=true and SIMULATION_ENABLED=false
  When dispatcher Tihara Egodage calls POST /simulations
  Then no simulation_runs row is created and ClockService keeps its mode
    And the same holds with SIMULATION_ENABLED=true and DEMO_MODE=false
    And with both flags true, store manager Nimesha Periyapperuma, driver Aniqa Razick and loader Harini De Mel get 403 FORBIDDEN on POST /simulations

AC-SIM-02  Create and start a run
  Given DEMO_MODE=true and SIMULATION_ENABLED=true
    And the Peliyagoda plan for 2 Oct 2026 is published
  When Tihara calls POST /simulations with scenario normal-day, that plan, seed 42 and speed 60
  Then the response is 201 with a Location header and status DRAFT
    And POST /simulations/{id}/start makes the run RUNNING, puts ClockService in simulated mode for the run, and broadcasts clock.changed
    And after 4 real minutes GET /simulations/{id} shows 4 hours of simulated time passed, the status and the KPIs so far
    And after POST /simulations/{id}/pause the simulated time stands still until POST /simulations/{id}/resume

AC-SIM-03  Same seed, same day
  Given two runs of normal-day on the same plan with seed 42 and speed 60, with POST /demo/reset before each
  When both run to the end
  Then both produce the same field events and pings in the same order, with the same simulated times, positions and payloads, apart from generated ids
    And both end with the same KPIs
    And a third run with seed 43 differs in at least one travel time

AC-SIM-04  Virtual drivers use the real endpoints
  Given a RUNNING normal-day run on the published Peliyagoda plan for 2 Oct 2026
  When simulated time reaches REF-07 trip 1's planned departure
  Then its virtual driver starts the trip and sends pings with source simulator through POST /telematics/pings
    And it records ARRIVED and DELIVERED through POST /sync, with receiver names from the fixed list
    And every audit row it causes has source SIMULATION
    And each stop.completed it causes reaches realtime, ETA, alerts, notifications and receipt as it would from a phone

AC-SIM-05  The driver-offline scenario reaches 19c
  Given a RUNNING driver-offline run
  When VAN-03 loses signal for 40 simulated minutes, records two deliveries offline, and one of its stops is deferred meanwhile
  Then 19 shows "No signal since" for VAN-03, and a VEHICLE_OFFLINE alert exists once 30 minutes have passed
    And after the late sync both deliveries show Synced late
    And the delivery at the deferred stop becomes one OPEN DELIVERED_AFTER_DEFERRAL conflict on 19c

AC-SIM-06  The reefer-breakdown scenario raises the alert
  Given a RUNNING reefer-breakdown run on the published Peliyagoda plan for 2 Oct 2026
  When simulated time reaches 04:40, before REF-07's second trip
  Then REF-07 breaks down and an alert with a repair suggestion is raised for the dispatcher
    And once the dispatcher applies the repair and reassigns the trip, revision notices go only to the affected people

AC-SIM-07  Trouble added live fires on time
  Given a RUNNING run at simulated time 05:30
  When Tihara calls POST /simulations/{id}/injections with kind ROAD_DELAY, atSim 06:00, the Kandy district as target, speedIndex 55 and 60 minutes
  Then one simulation_injections row exists with proposedBy human and firedAt null
    And when simulated time reaches 06:00 the injection fires: firedAt is set and the district's travel slows for 60 simulated minutes

AC-SIM-08  A stopped run reports its KPIs
  Given a RUNNING normal-day run with no model configured
  When Tihara calls POST /simulations/{id}/stop
  Then GET /simulations/{id} returns the KPIs: on-time percentage, stops delivered and failed, deferrals, km, litres, alerts raised and time to resolve them
    And simulation_runs.narrative holds the template's narrative and finishedAt is set
    And POST /demo/reset afterwards restores the demo day's plan

AC-SIM-09  (stretch) Director decisions are ordinary injections
  Given LLM_PROVIDER names the Anthropic adapter, the run is agentic, and it runs on synthetic data only
  When the worker sends the director its summary at each 20 simulated minutes
  Then each tool call becomes one simulation_injections row with proposedBy agent, carried out exactly as a person's
    And at the end the director's narrative is stored in simulation_runs.narrative
    And replaying the run from its stored injections with the same seed makes no model call and gives the same events

AC-SIM-10  (stretch) The director stays inside its guardrails
  Given an agentic run that has used 12 tool calls
  When the director proposes another injection, or one in the simulated past, or one on a plan that is not the run's
  Then no injection is stored and the run continues
    And the director never calls more than one tool per turn and has no route to real endpoints
    And with LLM_PROVIDER=disabled, the default, no director runs and the template writes the narrative
```

## Non-functional
- Runs only in the worker, and only with `SIMULATION_ENABLED=true` and `DEMO_MODE=true`.
- Deterministic: the same seed, scenario, plan and speed replay the same day; all randomness comes from
  the seeded generator.
- 60× by default, so a four-hour Fresh run plays in four minutes.
- Virtual drivers and loaders go through the real endpoints, so ETAs, alerts, notifications and receipts
  run the real code.
- A replay never calls a model: every director decision is stored as an ordinary injection.
- The director is off by default. Its prompts would carry state derived from the datasets (outlet ids,
  volumes), and the booklet forbids transmitting the datasets: demo it only on synthetic data until the
  organisers agree, and keep it out of anything that feeds the Task 2B submission.

## Open questions
- What does `POST /simulations` answer when a flag is off (403, 404 or 409)? Which status does `/stop`
  leave (COMPLETED is assumed)? (Aniqa)
- The doc names no `simulation.*` events, payloads or log events. Which are needed? (Aniqa)
- The scenarioKey comment lists normal-day, reefer-breakdown, driver-offline and agent; the scenario
  table adds monsoon-kandy and store-dispute. No Figma frame holds the run controls. (Aniqa)
- Stretch: have the organisers agreed to sending dataset-derived state to an outside model? (Nimesha)

## Changelog
- 2026-09-30 created from the Build Spec
