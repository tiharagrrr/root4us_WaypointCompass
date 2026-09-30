---
name: offline-action
description: Add or change a driver or loader action that must work offline (field event type,
  outbox.enqueue and the Dexie update, the POST /sync handler, clientUuid idempotency, conflict rule,
  tests). Use for any driver or loader write, Dexie or outbox change, /sync or sync-conflict work,
  or anything that must work with no signal.
---

# Add an offline action

## Before you start
- Read specs/execution/spec.md (driver) or specs/loading/spec.md (loader), and specs/sync/spec.md.
  Find the acceptance criteria this action serves.
- Find the frame in specs/frontend/screens.md. Rows marked "via outbox" must work offline.
- Check that the action may run offline at all. Trip release (L4) needs a connection, because it
  must confirm the latest plan revision. Anything like that is a normal online action.

## Steps
1. Event type. Add the type and its payload to the field-event zod union in packages/shared
   (discriminated on `type`). The payload holds ids, quantities, notes, attachment clientUuids and
   the version the device saw (stop, trip or plan revision). Update the hand-written @ApiBody for
   POST /sync, then run pnpm api:gen.
2. Reducer. Add a case to applyOptimistic(type, payload) in apps/frontend/src/offline. It changes the
   Dexie rows (trips, stops, loadLines) the way the server will. Keep it pure and small.
3. Screen. The screen calls outbox.enqueue(type, payload) and nothing else. One Dexie transaction
   adds the outbox row and applies the reducer, then pokes the sync engine. The row carries
   clientUuid (uuidv7(), made on the device), deviceSeq, status 'pending', occurredAt
   (serverAlignedNow()), deviceTime (the raw device clock) and baseVersion. The screen reads with
   useLiveQuery, so it updates at once with or without signal.
4. Attachments. Photos and signatures go into db.attachments as Blobs with their own clientUuid.
   The event refers to them by clientUuid. After the event applies, the attachment loop presigns,
   uploads and completes each one on its own retry.
5. Server handler. SyncService sorts the batch by deviceSeq and applies each event in its own
   savepoint, so one bad event never blocks the rest. Route the new type to the owning module:
   StopEventService.apply for driver events, LoadCheckService or LoadFlagService for loader events.
   That method checks the state machine and the base version, writes, calls audit.record with
   source OFFLINE_SYNC and the device time, calls outbox.add and logs one line. The online shortcut
   (for example POST /stops/{id}/arrive) calls the same method.
6. Idempotency. The target table has a unique clientUuid (stop_events, load_check_lines,
   load_flags, attachments, comments). A replay hits the constraint and returns `duplicate`, with
   no new row, audit row or event. A new table gets the unique column through the drizzle-change
   skill.
7. Time. occurredAt and deviceTime come from the device; receivedAt comes from ClockService on the
   server. Store both. isLateSync(occurredAt, receivedAt) flags events more than 5 minutes late,
   and the timeline shows Synced late.
8. Conflict rule. When server state makes the event impossible (stop deferred, cancelled or moved;
   trip reassigned; list revised), do not apply it. ConflictService records a SyncConflict and
   raises an alert, and the result is `conflict`. The dispatcher resolves it on 19c. KEEP_DEVICE
   stands the event and reverses the server change. KEEP_SERVER supersedes the event and tells the
   device. Write the rule for your type in the module spec.
9. Results and retry. Per item: `applied` and `duplicate` leave the outbox; `conflict` stays marked
   and shows on D6; `rejected` shows its message. Batches hold up to 100 items. Network errors and
   5xx retry after 2, 5, 15, 30, then every 60 seconds. A 401 pauses sync and keeps the outbox.
10. Pull. If server changes can affect this action, handle them where GET /sync/changes?since=
    writes into Dexie. A change to the stop in progress shows a banner.
11. Tests.
    - Unit: the applyOptimistic case, with Dexie rows before and after.
    - API e2e in __tests__/sync.e2e.spec.ts: the happy path through POST /sync; the same
      clientUuid sent twice returns `duplicate` and adds no audit row; a conflict case (see
      AC-SYN-06); an out-of-scope actor gets 404.
    - Playwright: go offline, do the action, see the offline banner and the pending count, go
      online, and see the count reach zero and the server state match.
12. Spec. Tick the acceptance criteria and list the event type and its conflict rule in the spec.

## Checklist
- [ ] The screen writes only through outbox.enqueue and reads through useLiveQuery
- [ ] clientUuid made on the device; unique on the server table
- [ ] Replaying the same clientUuid returns duplicate and adds nothing
- [ ] Conflict rule written, tested and visible on 19c
- [ ] occurredAt and deviceTime from the device; receivedAt from the server
- [ ] Offline banner and pending count checked
- [ ] pnpm check green

## Never
- Call a generated mutation hook or fetch directly from a driver or loader screen for a field write.
- Use the server clock for occurredAt or deviceTime, or overwrite them on the server.
- Drop a queued action silently: not on a 401, a conflict, a rejection or sign-out. D13 waits for
  an empty outbox and has no discard option.
- Make the clientUuid on the server, or reuse one across two taps.
- Edit a stored stop event. A later problem becomes an issue or a conflict resolution.
- Cache API responses in the service worker. Dexie is the data cache.
