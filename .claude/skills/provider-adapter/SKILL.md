---
name: provider-adapter
description: Add or change an outside-service adapter in apps/backend (email, SMS, push, chat,
  telematics or LLM) behind its port in core/providers, picked by an environment variable with a
  keyless local default. Use when adding or switching a provider, or editing ports.ts,
  providers.module.ts, env.schema.ts or a webhook verifier.
---

# Add a provider adapter

Every outside service sits behind a small port. Configuration picks the adapter: Compose runs on
Mailpit and the demo inbox with no keys, production swaps in a real provider with one variable, and
tests never touch the internet.

## Before you start
- Read apps/backend/src/core/providers/ports.ts and providers.module.ts.
- Read specs/notifications/spec.md (senders) or specs/webhooks/spec.md (callbacks).

## Steps
1. Port. Reuse the port in core/providers/ports.ts: EmailProvider, SmsProvider, PushProvider or
   ChatProvider, each `{ readonly name; send(m): Promise<SendResult>; health(): Promise<boolean> }`.
   A new kind of service gets a port of the same shape there, with its own token like
   EMAIL_PROVIDER or LLM_PROVIDER.
2. Adapter. One class per vendor, named <Vendor><Kind>Provider (TwilioSmsProvider,
   ResendEmailProvider). send() returns `{ provider: this.name, providerMessageId }`, passes
   idempotencyKey to the vendor when it supports one, and takes phone numbers in E.164 (+94...).
3. Errors. Map every failure to ProviderError(message, retryable, providerCode). Timeouts, 429 and
   5xx are retryable. 4xx answers such as an invalid number or a suppressed address are not, and
   end the notification FAILED with the reason.
4. Config. Add the variables to core/config/env.schema.ts (zod) and expose them through the matching
   AppConfig group (email, sms, push, llm and so on). Add them to .env.example with a working local
   value or an empty key, and extend the choice comment
   (`SMS_PROVIDER=demo-inbox  # demo-inbox | twilio | notifylk`). docker compose up and the tests
   must still run with every key empty.
5. Registry. Add the adapter to its token's factory map in core/providers/providers.module.ts,
   keyed by the variable's value: `twilio: () => new TwilioSmsProvider(cfg.sms.twilio)`.
6. Callbacks. If the vendor posts delivery receipts, add a WebhookVerifier in
   apps/backend/src/modules/webhooks/inbound/<provider>.verifier.ts: check the signature against the raw
   body and return `{ ok, externalId, eventType }`, using the vendor's event id as externalId.
   Handle the event in the webhooks.inbound job. Make the local fake post the same callbacks to
   /api/v1/webhooks/<provider>, as the Mailpit relay and the demo inbox do.
7. Telematics. A tracker vendor posts positions to the same gateway, as Traccar does at
   /webhooks/traccar. The job converts them to pings for execution's ping pipeline; it never writes
   vehicle positions itself.
8. Contract test. Run the port's shared suite (describeEmailProvider(factory) and its siblings)
   against the adapter with HTTP mocked: it sends, passes the idempotency key through, maps
   failures to ProviderError and answers health(). Real sends run only with PROVIDER_LIVE_TEST=1.
9. Health. health() is cheap and sends nothing. It feeds /health/ready as a warning, not a failure:
   the app keeps working while a provider is down, and the jobs retry.
10. Spec. List the provider, its variables and any production setup (a verified sending domain, a
    registered SMS sender ID) in the owning spec.

## Checklist
- [ ] Adapter implements the port and returns SendResult
- [ ] ProviderError with the right retryable flag for timeouts, 429, 5xx and 4xx
- [ ] env.schema.ts, AppConfig and .env.example updated; the local default needs no key
- [ ] Registered in providers.module.ts
- [ ] Shared contract suite passes with HTTP mocked
- [ ] health() wired and cheap

## Never
- Call a provider from a controller or during a request. Only worker jobs (notify.email,
  notify.sms, notify.push) send.
- Read process.env outside core/config.
- Commit a real key, or make one required for the local stack or CI.
- Let a test reach the internet without PROVIDER_LIVE_TEST=1.
- Log API keys, tokens, OTP codes, full phone numbers or email addresses.
- Turn on WhatsApp (ChatProvider) before 4 Oct; template approval takes days.
- Enable an LLM by default (LLM_PROVIDER=disabled), or send anything from data/seed/ to one.
