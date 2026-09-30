---
module: webhooks
owner: Nimesha
status: draft          # draft | ready | in-progress | done
screens: [A6]
depends-on: []
---

# Webhooks

## Purpose
Receive provider callbacks through one gateway that verifies the signature, stores each event
exactly once and answers at once, and send signed, retried events to other Waypoint systems in the
Standard Webhooks format, so any off-the-shelf verifier works on their side.

## Scope
In: the inbound gateway `POST /webhooks/{provider}`, one verifier per provider, the
`webhooks.inbound` job, admin replay; outbound endpoints, secrets and rotation, the
`webhooks.outbound` delivery job, retries, SSRF protection, the webhooks card on A6.
Out: what a callback changes: Notification statuses (notifications) and Traccar positions
(execution's ping pipeline, `POST /telematics/pings`); sending email and SMS (core/providers); SSE
(realtime).

## Model
Schema file apps/backend/src/db/schema/webhooks.ts.
- InboundWebhookEvent (inbound_webhook_events): provider (resend, twilio, traccar, notifylk),
  externalId, eventType, signatureOk, headers, payload, status (received, processed, ignored,
  failed), error, receivedAt, processedAt.
- WebhookEndpoint (webhook_endpoints): url, description, secretEnc (AES-GCM with
  APP_ENCRYPTION_KEY, shown once at creation), eventTypes[], active, createdById, createdAt,
  updatedAt.
- WebhookDelivery (webhook_deliveries): endpointId, eventId (the outbox id, sent as webhook-id),
  eventType, payload, status (PENDING, SUCCEEDED, FAILED, DEAD), attempt, nextAttemptAt,
  responseStatus, responseBody (first 2 KB), durationMs, lastError, createdAt, deliveredAt.

Invariants: inbound events are unique on (provider, externalId); deliveries are unique on
(endpointId, eventId).

## Endpoints
| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | /webhooks/{provider} | public, signature checked | resend, twilio, traccar, notifylk; raw body from the parser in main.ts; 200 at once, 401 on a bad signature |
| POST | /webhooks/inbound/{id}/replay | admin (see Open questions) | Re-runs processing; idempotent |
| GET, POST | /webhook-endpoints | webhook:manage | A6; POST returns the secret once |
| PATCH, DELETE | /webhook-endpoints/{id} | webhook:manage | A6 |
| POST | /webhook-endpoints/{id}/test | webhook:manage | Sends webhook.test |
| POST | /webhook-endpoints/{id}/rotate-secret | webhook:manage | Old and new signatures both sent for 24 hours |
| GET | /webhook-endpoints/{id}/deliveries | webhook:manage | Cursor pages |
| POST | /webhook-deliveries/{id}/retry | webhook:manage | Retries one delivery |

## Services and helpers
- `modules/webhooks/inbound/verifier.ts`: `WebhookVerifier { provider; verify(req: RawWebhookRequest): { ok, externalId, eventType? } }`.
- Verifiers and dedupe keys:

  | Provider | Sends | Signature check | Dedupe key |
  | --- | --- | --- | --- |
  | resend | Email delivered, bounced, complained | Svix headers (svix-id, svix-timestamp, svix-signature): HMAC-SHA256 over id, timestamp and body with the whsec_ secret, 5-minute tolerance | svix-id |
  | twilio | SMS status | X-Twilio-Signature: HMAC-SHA1 over the full URL and sorted form fields with the auth token | MessageSid plus status |
  | traccar | Device positions | Secret token in the header, HTTPS only | Device id plus fix time |
  | notifylk | SMS delivery reports, where the plan offers them | Token plus source IP allowlist | Message id |

- `webhooks.inbound` job: email and SMS statuses update Notification rows; Traccar positions enter
  the ping pipeline; the row ends processed, ignored or failed.
- `webhooks.outbound` job: one per endpoint and event; 10-second timeout; any 2xx is success;
  retries at 1 min, 5 min, 30 min, 2 h and 6 h, then DEAD; five DEAD in a row disable the endpoint.
- `modules/webhooks/outbound/sign.ts`: `signWebhook(secret, id, timestamp, body)` returns
  `v1,<base64 HMAC-SHA256 of id.timestamp.body>`, keyed by the base64 secret after `whsec_`.
- SSRF guard: HTTPS only outside development; resolve the host when the endpoint is saved and
  before every send; refuse 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1 and fc00::/7; never
  follow redirects.

## Events
Emits: none (Step 2 boundaries). `webhook.test` goes only to the endpoint under test.

Consumes (subscribable): plan.published, plan.revised, deferral.confirmed, trip.released,
stop.completed, stop.failed, trip.completed, receipt.confirmed, issue.reported, issue.resolved.

## Log events
- A signature failure logs at warn.
- Metric `webhook_deliveries_total` by status.
- Never logged: secrets, tokens, signature headers or request bodies.
- Event names follow `<module>.<entity>.<past-tense verb>`; the list is still open.

## Permissions
- Inbound `POST /webhooks/{provider}` is anonymous; trust comes only from the signature, token or
  IP allowlist.
- Every endpoint and delivery route needs `webhook:manage`, which only admin holds. Dispatcher,
  store manager, loader and driver get 403.

## Acceptance criteria

Progress: tick a criterion in the same PR as its passing test.

- [ ] AC-WHK-01 A signed Resend callback is stored once and answered at once
- [ ] AC-WHK-02 A bad signature is refused but kept
- [ ] AC-WHK-03 A duplicate callback stops at the insert
- [ ] AC-WHK-04 Twilio statuses dedupe on MessageSid plus status
- [ ] AC-WHK-05 Processing updates the notification
- [ ] AC-WHK-06 An admin can replay an event safely
- [ ] AC-WHK-07 Traccar positions become pings
- [ ] AC-WHK-08 An endpoint's secret is shown once
- [ ] AC-WHK-09 Deliveries are signed in the Standard Webhooks format
- [ ] AC-WHK-10 One delivery per endpoint and event
- [ ] AC-WHK-11 Failed deliveries retry, then go DEAD
- [ ] AC-WHK-12 Five dead deliveries in a row disable the endpoint
- [ ] AC-WHK-13 Private addresses and plain HTTP are refused
- [ ] AC-WHK-14 Secret rotation overlaps for 24 hours
- [ ] AC-WHK-15 A test event checks the wiring
```gherkin
AC-WHK-01  A signed Resend callback is stored once and answered at once
  Given a Resend delivered event signed with the configured whsec_ secret
    And its svix-timestamp is within 5 minutes of now
  When it is posted to POST /webhooks/resend
  Then the response is 200
    And one inbound_webhook_events row exists with provider resend, externalId equal to svix-id
      and signatureOk true
    And one webhooks.inbound job is queued for it

AC-WHK-02  A bad signature is refused but kept
  Given a Resend callback whose svix-signature was made with a different secret
  When it is posted to POST /webhooks/resend
  Then the response is 401
    And the row is stored with signatureOk false, a warn line is logged and no job is queued
    And a correctly signed callback whose svix-timestamp is 6 minutes old is refused the same way

AC-WHK-03  A duplicate callback stops at the insert
  Given the callback from AC-WHK-01 is already stored
  When Resend posts the same svix-id again
  Then the response is 200
    And the table still holds one row for it and no second job is queued

AC-WHK-04  Twilio statuses dedupe on MessageSid plus status
  Given an SMS sent through Twilio
  When Twilio posts "sent" and then "delivered" for its MessageSid, each with a valid
      X-Twilio-Signature over the full URL and sorted form fields
  Then two inbound rows exist, one per status
    And posting "delivered" again answers 200 and adds nothing

AC-WHK-05  Processing updates the notification
  Given a stored Resend delivered event for an EMAIL notification that is SENT
  When the webhooks.inbound job runs
  Then that Notification is DELIVERED
    And the inbound row is processed with processedAt set

AC-WHK-06  An admin can replay an event safely
  Given a processed inbound event
  When Rusiru Withanage (admin) calls POST /webhooks/inbound/{id}/replay twice
  Then the Notification ends in the same state as after the first processing
    And a dispatcher calling the same route gets 403

AC-WHK-07  Traccar positions become pings
  Given Traccar forwarding posts a device position over HTTPS with the configured secret token
  When it reaches POST /webhooks/traccar
  Then one inbound row is stored, deduped on device id plus fix time
    And the job hands the position to the ping pipeline as a ping
    And the same post without the token gets 401 and adds no ping

AC-WHK-08  An endpoint's secret is shown once
  Given Rusiru Withanage (admin)
  When he creates an endpoint for https://erp.example.lk/hooks/waypoint subscribed to stop.completed
  Then the response is 201 with a whsec_ secret, stored encrypted in secretEnc
    And later GET /webhook-endpoints responses never include the secret
    And a dispatcher calling POST /webhook-endpoints gets 403

AC-WHK-09  Deliveries are signed in the Standard Webhooks format
  Given that endpoint is active
  When stop.completed is published for order WF-0171
  Then the endpoint receives one POST with webhook-id equal to the outbox event id,
      webhook-timestamp in Unix seconds and webhook-signature "v1,<base64 HMAC-SHA256>" over
      id.timestamp.body
    And the body is {"type":"stop.completed","timestamp":...,"data":{"orderNo":"WF-0171",
      "outletId":"OUT014","outcome":"DELIVERED"}} with no names, phone numbers or photos
    And a 2xx answer within 10 seconds marks the delivery SUCCEEDED

AC-WHK-10  One delivery per endpoint and event
  Given stop.completed for WF-0171 was delivered to the endpoint
  When the relay publishes the same event again
  Then webhook_deliveries holds one row for that endpoint and event, and no second POST is sent

AC-WHK-11  Failed deliveries retry, then go DEAD
  Given the endpoint answers 500, or takes longer than 10 seconds, on every attempt
  When stop.completed is delivered to it
  Then retries follow 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours later
    And after the last one the delivery is DEAD and admins are notified

AC-WHK-12  Five dead deliveries in a row disable the endpoint
  Given an endpoint whose last four deliveries are DEAD
  When a fifth delivery in a row goes DEAD
  Then the endpoint's active flag is false and no new deliveries are queued for it

AC-WHK-13  Private addresses and plain HTTP are refused
  Given Rusiru Withanage (admin) with APP_ENV=staging
  When he saves an endpoint with an http:// URL, or a host that resolves to 10.0.0.5, 127.0.0.1
      or 169.254.169.254
  Then the response is 400 VALIDATION_FAILED on url and nothing is saved
    And a saved host that later resolves to a private address is refused before the send
    And a 3xx answer to a delivery is not followed

AC-WHK-14  Secret rotation overlaps for 24 hours
  Given an active endpoint
  When an admin calls POST /webhook-endpoints/{id}/rotate-secret
  Then for the next 24 hours each delivery's webhook-signature carries both signatures,
      space-separated
    And after 24 hours only the new signature is sent

AC-WHK-15  A test event checks the wiring
  Given an active endpoint
  When an admin calls POST /webhook-endpoints/{id}/test
  Then the endpoint receives one webhook.test POST, signed like any other delivery
```

## Non-functional
- The gateway answers 200 typically within 50 ms; the real work runs in the webhooks.inbound job.
- Webhook routes get the raw body (up to 1 MB) from the parser mounted in main.ts, so signatures
  are checked against the exact bytes.
- Outbound sends time out after 10 seconds, use HTTPS only outside development and never follow
  redirects. Receivers reject timestamps more than 5 minutes old.
- Endpoint secrets are encrypted with AES-GCM under APP_ENCRYPTION_KEY and shown once.
- In development the Mailpit relay and the demo SMS inbox post their own status callbacks to the
  gateway, so delivered, failed and read run end to end with no provider accounts.

## Open questions
- Which permission guards POST /webhooks/inbound/{id}/replay? The doc says "an admin"; is it webhook:manage?
- How does the webhooks.inbound job update Notification rows and feed Traccar pings when webhooks may import only core?
- Which event and recipients carry "admins are notified" for a DEAD delivery?
- Are admins told when an endpoint is disabled, and does PATCH active true re-enable it?
- Where does the previous secret live during the 24-hour rotation overlap? webhook_endpoints has one secretEnc.
- What is the header name and format of the Traccar secret token?
- Which source IPs are on the Notify.lk allowlist, and does the chosen plan send delivery reports?
- When does an inbound row end as ignored rather than failed?
- Is 400 VALIDATION_FAILED the right answer for a refused endpoint URL?
- May a row stored with signatureOk false be replayed?
- How long are inbound_webhook_events and webhook_deliveries kept?
- Which log event names does the module write?

## Changelog
- 2026-09-30 created from the Build Spec
