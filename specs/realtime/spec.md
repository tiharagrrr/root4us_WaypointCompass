---
module: realtime
owner: Nimesha
status: draft          # draft | ready | in-progress | done
screens: []            # no frame of its own; every live screen reads /streams/me through useEventStream
depends-on: [identity]
---

# Realtime

## Purpose
Give each signed-in client one authenticated SSE stream that carries every change it may see. The
browser reconnects on its own and the server replays what was missed, so no screen polls and no API
instance needs sticky sessions.

## Scope
In: `GET /streams/me`, channel selection from role and scope, replay from Redis Streams,
reference-counted Redis pub/sub fan-out, heartbeats, the resync signal, the `sse_connections`
metric.
Out: producing events (every module, through the outbox; audit-and-events skill); the outbox relay
in the worker, which publishes and appends to the replay streams; location ingest, positions, ETA and
signal watch (execution, `POST /telematics/pings`); notification rows (notifications); the web
client `apps/frontend/src/realtime/use-event-stream.ts`.

## Model
No tables and no schema file. Redis holds the state:
- one Redis Stream per channel for replay (`XADD ... MAXLEN ~ 2000`, kept 24 hours);
- one pub/sub channel per SSE channel for live fan-out.

Invariants: a frame's id is the outbox event id, so a replay is exact; position frames use
`<vehicleId>:<recordedAt>` and are never kept in the replay streams.

## Endpoints
| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | /streams/me | any signed-in user (session cookie) | text/event-stream; channels from role and scope; honours Last-Event-ID |

## Services and helpers
- `modules/realtime/streams.controller.ts`: `StreamsController` with `@Sse('me')`, merging
  `hub.replay(channels, lastEventId)`, `hub.live(channels)` and a 15-second heartbeat, closed when
  the request closes.
- `RealtimeHub`: `replay()` returns the missed events, or one `resync` event when the id is too
  old; `live()` subscribes to Redis pub/sub, reference-counted per instance.
- `channelsFor(actor)`:

  | Role | Channels |
  | --- | --- |
  | Dispatcher | `depot:<id>`, or every depot when unscoped |
  | Store manager | `outlet:<id>` |
  | Loader | `depot:<id>:loading` |
  | Driver | `trip:<id>` for each of their trips |
  | Everyone | `user:<id>` and `broadcast` (clock and settings changes) |

- Frame: `id` is the outbox id, `event` is the type, `data` is the DomainEvent JSON (v, type,
  aggregate, routing, data, occurredAt). Keep-alive: `retry: 3000` and a heartbeat every 15 s.

## Events
Emits: none (Step 2 boundaries).

Consumes:
- every outbox event, routed by its depotId, outletIds and userIds;
- `vehicle.position` straight from the ping pipeline (not the outbox), at most once per vehicle
  every 5 seconds per channel;
- `clock.changed` and `settings.changed` on `broadcast`;
- `identity.user.role_changed` and `identity.user.deactivated` on `user:<id>`, so the client
  refreshes `/me`.

## Log events
- Metric `sse_connections` gauge by role.
- Never logged: cookies, tokens or event bodies.
- Event names follow `<module>.<entity>.<past-tense verb>`; the list is still open.

## Permissions
- Any signed-in user may open the stream; with no session the answer is 401 UNAUTHENTICATED.
- The client cannot choose channels. They come only from the actor's role and scope.
- Stores see only their own delivery's ETA, never the map: store managers get no
  `vehicle.position` events.

## Acceptance criteria

Progress: tick a criterion in the same PR as its passing test.

- [ ] AC-RT-01 A dispatcher's stream covers her depots
- [ ] AC-RT-02 A store manager sees only her outlet
- [ ] AC-RT-03 Loaders and drivers get their own channels
- [ ] AC-RT-04 Frames carry the outbox id and the envelope
- [ ] AC-RT-05 A reconnect replays what was missed
- [ ] AC-RT-06 A too-old id gets a resync
- [ ] AC-RT-07 Positions are throttled and never replayed
- [ ] AC-RT-08 Stores never see the map
- [ ] AC-RT-09 Idle streams stay alive
- [ ] AC-RT-10 Fan-out subscribes only while a client needs it
- [ ] AC-RT-11 Clock changes reach everyone
- [ ] AC-RT-12 No session, no stream
- [ ] AC-RT-13 A role change reaches the user at once
```gherkin
AC-RT-01  A dispatcher's stream covers her depots
  Given dispatcher Tihara Egodage with no depot set (all depots)
  When she opens GET /streams/me with her session cookie
  Then the response is 200 text/event-stream with retry: 3000
    And her channels are depot:<id> for every depot, user:<her id> and broadcast

AC-RT-02  A store manager sees only her outlet
  Given store manager Nimesha Periyapperuma for Fresh Kadawatha has an open stream
  When order.submitted is published for Fresh Kadawatha and for another outlet
  Then her stream carries exactly the Fresh Kadawatha event

AC-RT-03  Loaders and drivers get their own channels
  Given loader Harini De Mel at Peliyagoda and driver Aniqa Razick on REF-07 open streams
  Then Harini's channels are depot:<Peliyagoda id>:loading, user:<her id> and broadcast
    And Aniqa's are trip:<REF-07 id>, user:<her id> and broadcast
    And a trip.released for DRY-31 never reaches Aniqa's stream

AC-RT-04  Frames carry the outbox id and the envelope
  Given plan.published for Peliyagoda is committed as outbox event E
  When the relay publishes it
  Then a Peliyagoda dispatcher's stream receives a frame with id E and event plan.published
    And its data holds v 1, type, aggregate {type: plan, id}, routing, data and occurredAt

AC-RT-05  A reconnect replays what was missed
  Given Tihara's stream last received event E1
    And E2 and E3 are published for Peliyagoda while she is offline for 2 minutes
  When the browser reconnects with Last-Event-ID E1
  Then she receives E2 then E3, then live events
    And E1 is not sent again

AC-RT-06  A too-old id gets a resync
  Given Tihara's Last-Event-ID is no longer in the channel's Redis Stream (trimmed past about
      2,000 entries or older than 24 hours)
  When she reconnects
  Then the first frame is a resync event
    And useEventStream invalidates every query, which refetches the latest positions too

AC-RT-07  Positions are throttled and never replayed
  Given VEH014 on REF-07 sends a ping every second
  When a Peliyagoda dispatcher watches the tracking map (19)
  Then her stream carries vehicle.position for VEH014 at most once every 5 seconds, with id
      <vehicleId>:<recordedAt>
    And a reconnect with Last-Event-ID replays no position events

AC-RT-08  Stores never see the map
  Given Nimesha's stream is open while REF-07 delivers to Fresh Kadawatha
  When positions and eta.updated for her stop are published
  Then she receives eta.updated for her delivery and no vehicle.position events

AC-RT-09  Idle streams stay alive
  Given an open stream with no events for 45 seconds
  Then it has received 3 heartbeat events, one every 15 seconds

AC-RT-10  Fan-out subscribes only while a client needs it
  Given two API instances and one Peliyagoda dispatcher connected to instance A
  When an event for Peliyagoda is published
  Then instance A writes it to her stream and instance B holds no subscription for that channel
    And when she disconnects, instance A unsubscribes and sse_connections{role="dispatcher"}
      drops by one

AC-RT-11  Clock changes reach everyone
  Given DEMO_MODE=true and open streams for all five roles
  When the admin sets the demo clock through PUT /clock
  Then every stream receives clock.changed on broadcast

AC-RT-12  No session, no stream
  Given a request with no session cookie
  When it calls GET /streams/me
  Then the response is 401 UNAUTHENTICATED as application/problem+json

AC-RT-13  A role change reaches the user at once
  Given Harini De Mel has an open stream
  When the admin changes her role
  Then identity.user.role_changed arrives on user:<her id>
    And the client refreshes /me
```

## Non-functional
- Redis carries anything a screen must see within a second. The relay is nudged through
  `outbox:nudge` after commit (about 100 ms) and also polls every 500 ms.
- Nothing on a screen polls; each client holds one stream.
- Instances scale out with no shared state and no sticky sessions.
- Caddy uses `flush_interval -1` and no compression on the streams route.
- Replay depth is about 2,000 events per channel, kept 24 hours.

## Open questions
- What are the Redis key names for the replay streams and pub/sub channels?
- Does the mapping from routing to channels live in the relay (core) or in realtime?
- How do routing fields map onto depot:<id>:loading and trip:<id>?
- Which channels carry vehicle.position: depot:<id> only, or trip:<id> too?
- Does an admin get any channel beyond user:<id> and broadcast?
- Which trips put a driver on trip:<id>: today's, or the 7 days of the driver scope?
- Does a role or scope change close the open stream so its channels are recomputed?
- How is comment.created routed to "everyone on that record"?
- Which log event names does the module write for stream open and close?

## Changelog
- 2026-09-30 created from the Build Spec
