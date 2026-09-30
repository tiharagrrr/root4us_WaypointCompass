# Modules

One folder per module. Every module is already registered in `src/app.module.ts`, so an owner adds
providers and controllers inside their own folder and never needs to edit that file. Start with the
module's spec, then follow `apps/backend/CLAUDE.md` ("Adding a use case") and the `nest-module`
skill.

| Module        | Owner   | Spec                                                     | Tables (`src/db/schema/`)                |
| ------------- | ------- | -------------------------------------------------------- | ---------------------------------------- |
| identity      | Nimesha | [identity](../../../../specs/identity/spec.md)           | `identity.ts`, settings in `platform.ts` |
| audit         | Nimesha | [audit](../../../../specs/audit/spec.md)                 | `audit.ts`                               |
| master-data   | Harini  | [master-data](../../../../specs/master-data/spec.md)     | `master-data.ts`                         |
| ordering      | Harini  | [ordering](../../../../specs/ordering/spec.md)           | `ordering.ts`                            |
| fleet         | Tihara  | [fleet](../../../../specs/fleet/spec.md)                 | `fleet.ts`                               |
| planning      | Tihara  | [planning](../../../../specs/planning/spec.md)           | `planning.ts`                            |
| forecasting   | Tihara  | [forecasting](../../../../specs/forecasting/spec.md)     | `forecasting.ts`                         |
| loading       | Harini  | [loading](../../../../specs/loading/spec.md)             | `loading.ts`                             |
| execution     | Aniqa   | [execution](../../../../specs/execution/spec.md)         | `execution.ts`                           |
| sync          | Aniqa   | [sync](../../../../specs/sync/spec.md)                   | `sync.ts`                                |
| receipt       | Harini  | [receipt](../../../../specs/receipt/spec.md)             | `receipt.ts`                             |
| alerts        | Harini  | [alerts](../../../../specs/alerts/spec.md)               | `alerts.ts`                              |
| notifications | Nimesha | [notifications](../../../../specs/notifications/spec.md) | `notifications.ts`                       |
| webhooks      | Nimesha | [webhooks](../../../../specs/webhooks/spec.md)           | `webhooks.ts`                            |
| realtime      | Nimesha | [realtime](../../../../specs/realtime/spec.md)           | none                                     |
| simulation    | Aniqa   | [simulation](../../../../specs/simulation/spec.md)       | `simulation.ts`                          |

## Boundaries

- Import another module only from its `index.ts` (`from '../planning'`), never from its other files.
- Import only the modules listed in the `depends-on` line of your own spec. That line is the
  allowed-imports table; change it in the same PR as the import, and tell the other module's owner.
- When you only need another module to react, emit an outbox event instead of importing it.
- `pnpm --filter api check:boundaries` checks all of this (it also runs in `pnpm check` and CI).

## Anatomy

Create these as you need them; empty folders are not committed.

```
<module>/
  <module>.module.ts        providers, controllers, exports
  index.ts                  the public surface: the module class, query service, lifecycle service, event types
  <module>.constants.ts     queue names, event names, setting keys
  controllers/  dto/        thin controllers; class-validator request DTOs and Swagger response DTOs
  services/                 <entities>.service.ts (commands), <entity>.queries.ts (reads),
                            <entity>-lifecycle.service.ts if other modules move a status this module owns
  policies/                 <entity>.scope.ts (ScopePolicy), <entity>.links.ts (LinkBuilder)
  domain/                   pure functions; the time comes in as a parameter
  jobs/                     BullMQ processors, run by the worker
  events/                   typed event payloads with v: 1
  __tests__/                one test per acceptance criterion, named after its AC id
```
