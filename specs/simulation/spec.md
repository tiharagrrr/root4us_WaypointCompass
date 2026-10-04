---
module: simulation
owner: Aniqa
status: in-progress    # draft | ready | in-progress | done
screens: [A6]
depends-on: [audit, planning, execution, fleet]
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
- The `LlmProvider` port and its Anthropic and OpenAI-compatible adapters: core providers
  (provider-adapter skill).
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
| GET | /simulations/{id} | simulation:run | Status, simulated time, KPIs and the run's injections |
| GET | /simulations | simulation:run | The newest 20 runs in scope. Its `_links` carry `create`, `director` (only while the AI director is on) and `enableDirector` or `disableDirector` for whoever may change the setting |

Built so far (ROO-55): `POST /simulations` also takes `agentic` (409 unless the collection carries the
`director` link) and `replayOf` (a run id: the same scenario, plan, seed and speed, its stored injections
copied, never agentic). Injections carried out: ROAD_DELAY (`target.districtId`, `params.speedIndex` 10 to
100 and `params.minutes`) and FAILED_DELIVERY (`target.stopId`, `params.reason` REFUSED, DAMAGED or
OUTLET_CLOSED); the other kinds answer 400 until ROO-63. One run at a time holds the demo clock: starting
a second is 409. A run starts 10 simulated minutes before its plan's first departure, and stopping it
freezes the demo clock at the run's last simulated instant.

The module runs in the worker (`modules/simulation`, played by `worker/simulation.loop.ts` once a real
second) and only when `SIMULATION_ENABLED=true` and `DEMO_MODE=true`; with either off every endpoint
answers 404, like the demo tools.

The AI switch has two parts. The server gate is `LLM_PROVIDER`: `disabled` (default, no model exists),
`scripted` (a keyless fake for local runs and tests), `anthropic` (`ANTHROPIC_API_KEY`, `LLM_MODEL`,
which defaults to `claude-opus-5-5`) or `openai-compatible`, which is any server that speaks the OpenAI
chat completions API: `LLM_BASE_URL` carries the version path (`https://api.openai.com/v1`,
`https://openrouter.ai/api/v1`, `http://localhost:11434/v1`), `LLM_MODEL` is required and has no
default, and `LLM_API_KEY` is optional, because a local server asks for none. That adapter stays inside
the part of the API every server implements — `max_tokens`, plain function tools with no `strict`, no
`parallel_tool_calls` — so a gateway or a local model needs no code change. The director takes one tool
call a turn whatever comes back, so a server that returns several is not refused.
The runtime toggle is the setting `simulation.aiDirector` (boolean, default false), which an admin flips
on A6 → Demo. The director is on only with both, and only then does `GET /simulations` carry the
`director` link that lets a screen offer an agentic run, the AI badges and the director's report.

## Services and helpers
- Run commands: create, start, pause, resume, stop. Start sets the `demo.clock` mode to
  `{ mode: 'simulated', runId }`.
- Seeded generator: mulberry32, one per run, feeding travel noise (±10%), service-time noise and GPS
  jitter. No `Math.random` or `Date.now` in simulation logic.
- Built so far: the virtual driver records TRIP_STARTED, ARRIVED, DELIVERED or FAILED and TRIP_COMPLETED
  through execution's `StopEventService.apply` (the handler behind the driver endpoints and `POST /sync`)
  as the trip's own driver, at the planned times, later while a ROAD_DELAY holds the district. No pings
  until `POST /telematics/pings` exists (ROO-37); no seeded noise, loaders or scenarios yet (ROO-47, ROO-63).
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
has no route to real endpoints; the prompt is fixed; the call budget is hard.

Built so far: three tools (`inject_road_delay`, `inject_failed_delivery`, `noop`), each with an optional
`atSim`. The summary carries ids, vehicle codes, district ids, statuses and times only: no outlet,
address, item or volume, and no open alerts yet. The turn counter lives in `simulation_runs.kpis.director`
(the table has no column for it). The report is written by the worker after `/stop`, never in the request. Provider: the `LlmProvider`
port with an Anthropic adapter and an OpenAI-compatible one, behind `LLM_PROVIDER=disabled` by default.

## Events
Emits (each `{ v: 1, runId, ... }`, audited under the same name with source SIMULATION):
`simulation.run.created`, `simulation.run.started`, `simulation.run.paused`, `simulation.run.resumed`,
`simulation.run.stopped`, `simulation.injection.added`, `simulation.injection.fired`. Start and stop also
emit core's `clock.changed`; the loop's own clock steps do not.

Consumes: none. A run's clock change reaches clients as core's `clock.changed`.

## Log events
The events above, plus `simulation.director.turn`, `simulation.director.rejected`,
`simulation.director.failed`, `simulation.driver.refused` and `simulation.run.tick_failed`.

## Permissions
| Permission | Roles holding it | Used for |
| --- | --- | --- |
| `simulation:run` | admin, dispatcher | Every simulation endpoint |

Store managers, loaders and drivers do not hold `simulation:run` and get 403.

## Acceptance criteria
- [x] AC-SIM-01 Runs only in demo mode, for simulation:run
- [x] AC-SIM-02 Create and start a run
- [ ] AC-SIM-03 Same seed, same day
- [ ] AC-SIM-04 Virtual drivers use the real endpoints (field events built; pings wait for ROO-37)
- [ ] AC-SIM-05 The driver-offline scenario reaches 19c
- [ ] AC-SIM-06 The reefer-breakdown scenario raises the alert
- [x] AC-SIM-07 Trouble added live fires on time
- [ ] AC-SIM-08 A stopped run reports its KPIs
- [x] AC-SIM-09 (stretch) Director decisions are ordinary injections
- [x] AC-SIM-10 (stretch) The director stays inside its guardrails

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
  Given LLM_PROVIDER names a model adapter (anthropic or openai-compatible), the run is agentic, and it runs on synthetic data only
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
- Assumed in ROO-55, for Aniqa to confirm: a flag off answers 404; `/stop` leaves COMPLETED and freezes
  the demo clock where the run ended; a run starts 10 simulated minutes before the plan's first
  departure; the events and log events listed above; `GET /simulations` exists for the run panel.
- AC-SIM-09's replay is tested on the same plan put back as seeded. After `POST /demo/reset` the stops
  have new ids, so a stored FAILED_DELIVERY (targeted by stopId) no longer matches; ROAD_DELAY does. (Aniqa)
- The scenarioKey comment lists normal-day, reefer-breakdown, driver-offline and agent; the scenario
  table adds monsoon-kandy and store-dispute. No Figma frame holds the run controls: the panel on A6 →
  Demo was built from A6's own rows. (Aniqa)
- Stretch: have the organisers agreed to sending dataset-derived state to an outside model? Until they
  do, the summary is limited to ids, vehicle codes, district ids, statuses and times, and local runs use
  `LLM_PROVIDER=scripted` (decided 2026-10-04). (Nimesha)

## Changelog
- 2026-09-30 created from the Build Spec
- 2026-10-04 AC-SIM-01, 02, 07, 09 and 10 implemented, AC-SIM-04 in part (ROO-55): run commands and the
  worker loop, virtual drivers through execution's field-event handler, ROAD_DELAY and FAILED_DELIVERY,
  the agentic director behind `LLM_PROVIDER` and the `simulation.aiDirector` setting, the A6 → Demo panel
- 2026-10-04 The dispatcher reaches the run panel at /dispatch/simulation, from a Simulation entry in the
  dispatch sidebar (ROO-55); the page says why it is blank when demo mode or the simulator is off
