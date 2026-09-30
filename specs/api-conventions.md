# API conventions

Read sections 1 to 5 before you add or change an endpoint in `apps/backend`. Sections 6 to 10 describe the shared layer those rules rest on. Source: Build Spec Step 4 (API standards and the CRUD layer), plus the request lifecycle, domain errors and permissions from Step 2.

Every endpoint speaks REST at Richardson Level 3: resources with stable URLs, correct verbs and status codes, and `_links` that tell the client what it may do next. One envelope, one pagination scheme per list type and one error format keep 100+ endpoints predictable for people and agents.

Paths that do not start with `apps/` or `packages/` are relative to `apps/backend/src`.

## Quick rules

1. Resources are plural kebab-case nouns under `/api/v1`; a state change is `POST /{resource}/{id}/{verb}`.
2. A success is `{ data, meta }` plus `_links`; an action link appears only when the server would accept that action now.
3. An error is a `DomainError` subclass rendered as `application/problem+json` with a stable `code`; out of scope is 404, a missing permission 403.
4. Tables page with `limit` and `offset`, feeds with `cursor`; filters, sorts and includes must be on the resource's whitelist.
5. Versioned writes need `If-Match: W/"<version>"` (428 when missing, 412 when stale); creates and non-repeatable actions take an `Idempotency-Key`.
6. After any controller or DTO change, run `pnpm api:gen` and commit `openapi.json`; never edit `packages/api-client/src/gen`.

## 1. Resources and URLs

Resources are nouns under `/api/v1`, state changes are named actions on the resource, and the API root tells each role where to start. Clients navigate by following links rather than building URLs.

- **Base paths.** `/api/v1` for the API, `/api/auth/*` for BetterAuth, `/health/*` and `/metrics` outside both.
- **Nouns.** Plural kebab-case: `/orders`, `/order-templates`, `/audit-events`. Nest only for true containment: `/orders/{id}/lines`, `/trips/{id}/stops`, `/trips/{id}/load-list`.
- **Natural keys** where people use them: `/depots/PLG/plans/2026-10-02` returns the day's plan (creating the draft on first access), and `/me/trips?date=2026-10-02` returns a driver's day.
- **Verbs.** GET reads. POST creates (201 with `Location`) or runs an action. PATCH partly updates drafts and master data (JSON merge patch). PUT replaces a setting value or a whole line set. DELETE removes drafts only; orders are cancelled, not deleted.
- **Actions** are `POST /{resource}/{id}/{verb}` with a small body such as a reason: `/orders/{id}/submit`, `/plans/{id}/publish`, `/trips/{id}/release`, `/deferrals/{id}/response`.
- **/me** is the caller's own view: `/me`, `/me/trips`, `/me/notifications`, `/me/devices`.
- **Queries** read `?filter[status]=CONFIRMED,PLANNED&filter[deliveryDate][gte]=2026-10-01&sort=-submittedAt&q=kadawatha&limit=10&offset=20&include=lines,outlet` (section 4).
- **Values.** camelCase JSON. Instants in ISO 8601 with offset (`2026-10-02T03:30:00+05:30`). Business dates as `YYYY-MM-DD`. Minutes of the day as integers beside a label (`windowOpenMin: 360, windowOpen: "06:00"`). Money as LKR integers. kg and m³ with 2 decimals.

The web app's first call after sign-in is the root. Each role shell picks its landing route from the links it gets back.

```json
// GET /api/v1 as Tihara (dispatcher, all depots, Peliyagoda by default)
{
  "data": {
    "name": "Waypoint Compass API",
    "actor": { "id": "u_0192...", "name": "Tihara Egodage", "role": "dispatcher", "depotId": null },
    "_links": {
      "self": { "href": "/api/v1" },
      "me": { "href": "/api/v1/me" },
      "today": { "href": "/api/v1/depots/PLG/days/2026-10-01", "title": "Today at Peliyagoda" },
      "tomorrowPlan": { "href": "/api/v1/depots/PLG/plans/2026-10-02", "title": "Tomorrow's plan" },
      "orders": { "href": "/api/v1/orders{?filter,sort,q,limit,offset}", "templated": true },
      "alerts": { "href": "/api/v1/alerts?filter[status]=OPEN" },
      "tracking": { "href": "/api/v1/depots/PLG/tracking" },
      "events": { "href": "/api/v1/streams/me" },
      "docs": { "href": "/api/docs" }
    }
  },
  "meta": { "requestId": "0192...", "serverTime": "2026-10-01T15:12:00+05:30", "apiVersion": "1.0.0" }
}
```

A driver's root carries `myTrips`, a loader's `loadingBoard`, and a store manager's `myOrders` and `deliveries` instead.

## 2. Envelope and _links

Every success response has three parts: the resource, metadata, and links that say what the caller can do next. A missing link means the action is not available, and the UI does not render the button.

```json
// GET /api/v1/orders/0192a3f4-... as Nimesha (store manager), Thu 1 Oct 15:40
// 200 OK, ETag: W/"3"
{
  "data": {
    "id": "0192a3f4-...",
    "orderNo": "WF-0171",
    "status": "SUBMITTED",
    "tempClass": "AMBIENT",
    "requestedDate": "2026-10-02",
    "deliveryDate": "2026-10-02",
    "afterCutoff": false,
    "totals": { "units": 42, "weightKg": 318.4, "volumeM3": 2.61 },
    "outlet": { "id": "OUT014", "name": "Fresh Kadawatha" },
    "submittedAt": "2026-10-01T14:02:11+05:30",
    "editableUntil": "2026-10-01T16:00:00+05:30",
    "version": 3,
    "_links": {
      "self": { "href": "/api/v1/orders/0192a3f4-..." },
      "lines": { "href": "/api/v1/orders/0192a3f4-.../lines" },
      "timeline": { "href": "/api/v1/timelines/order/0192a3f4-..." },
      "edit": { "href": "/api/v1/orders/0192a3f4-...", "method": "PATCH", "title": "Edit order", "requires": ["If-Match"] },
      "cancel": { "href": "/api/v1/orders/0192a3f4-.../cancel", "method": "POST", "title": "Cancel order",
                  "requires": ["If-Match", "reasonNote"] }
    }
  },
  "meta": { "requestId": "0192a3f5-...", "serverTime": "2026-10-01T15:40:03+05:30", "apiVersion": "1.0.0" }
}
```

At 16:00 the same request returns no `edit` or `cancel` link. Collections put paging in `meta.page` and navigation in top-level `_links`:

```json
// GET /api/v1/orders?filter[status]=SUBMITTED&limit=10&offset=10 as Tihara
{
  "data": [
    { "id": "0192...", "orderNo": "WF-0172", "status": "SUBMITTED", "_links": { "self": { "href": "/api/v1/orders/0192..." } } }
  ],
  "meta": { "requestId": "0192...", "serverTime": "2026-10-01T15:41:10+05:30", "page": { "limit": 10, "offset": 10, "total": 57 } },
  "_links": {
    "self":  { "href": "/api/v1/orders?filter[status]=SUBMITTED&limit=10&offset=10" },
    "first": { "href": "/api/v1/orders?filter[status]=SUBMITTED&limit=10&offset=0" },
    "prev":  { "href": "/api/v1/orders?filter[status]=SUBMITTED&limit=10&offset=0" },
    "next":  { "href": "/api/v1/orders?filter[status]=SUBMITTED&limit=10&offset=20" },
    "last":  { "href": "/api/v1/orders?filter[status]=SUBMITTED&limit=10&offset=50" }
  }
}
```

```ts
// packages/shared/src/api/link.ts
export interface Link {
  href: string;                                        // path; an RFC 6570 template when templated
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; // default GET
  title?: string;                                      // label the UI may use
  templated?: boolean;
  requires?: string[];                                 // headers or body fields: If-Match, Idempotency-Key, reasonCode
}
```

**The affordance rule.** An action link appears only when all four hold:

1. the state machine allows the transition;
2. the actor has the permission;
3. the row is in the actor's scope;
4. the time rules allow it (before the cutoff, after publishing opens, plan not locked).

Link builders call the same `can*()` helpers the services use, so a link never promises something the server would refuse. E2e tests check each link's presence and absence.

- **Relation names:** `self`, `first`, `prev`, `next`, `last`, `create`, `edit`, `cancel`, and domain verbs such as `submit`, `publish`, `release`, `reassign`, `resequence`, `respond`, `acknowledge`, `resolve`.
- **Notices:** `meta.notices: [{ code, message }]` carries information that is not an error, such as `ORDER_ROLLED_TO_NEXT_RUN` for M2.
- **Embedded data:** `?include=lines,outlet` puts related resources under `_embedded`, each with its own links.

## 3. Errors

Every error is RFC 9457 problem+json with a stable machine code, the request id, and field-level details whenever the client can fix something.

```json
// POST /api/v1/plans/0192.../edits → 422, Content-Type: application/problem+json
{
  "type": "https://compass.waypoint.lk/problems/plan-rule-violation",
  "title": "The change breaks a planning rule",
  "status": 422,
  "code": "PLAN_RULE_VIOLATION",
  "detail": "Moving WF-0171 onto REF-07 trip 1 exceeds its volume by 0.42 m³.",
  "instance": "/api/v1/plans/0192.../edits",
  "requestId": "0192a3f5-...",
  "violations": [
    { "rule": "CAP_VOLUME", "severity": "HARD", "tripKey": "REF-07#1", "actual": 12.42, "limit": 12.0,
      "message": "Over volume by 0.42 m³" }
  ],
  "_links": {
    "fixes": { "href": "/api/v1/plans/0192.../suggest-fixes", "method": "POST", "title": "Suggest fixes" }
  }
}
```

```json
// PATCH /api/v1/orders/0192.../lines → 400
{
  "type": "https://compass.waypoint.lk/problems/validation-failed",
  "title": "Some fields need attention",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "requestId": "0192...",
  "errors": [{ "field": "lines[2].qty", "code": "min", "message": "Enter at least 1" }]
}
```

### Problem codes

| Code | Status | When | What the UI does |
| --- | --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Body, query or filter is invalid | Field messages through `applyProblem` |
| `UNAUTHENTICATED` | 401 | No session or it expired | Sign-in; the offline outbox pauses |
| `FORBIDDEN` | 403 | The role lacks the permission | No-access state with a link home |
| `NOT_FOUND` | 404 | Missing, or outside the actor's scope | Not-found state |
| `CONFLICT_STATE` | 409 | The state machine refuses, or a duplicate order | Refresh, with a link to the conflicting record |
| `CUTOFF_PASSED` | 409 | Edit or cancel after the cutoff | M2's after-cutoff state |
| `PLAN_LOCKED` | 409 | Publishing before it opens, or editing a closed plan | Banner with the time it opens |
| `VERSION_MISMATCH` | 412 | `If-Match` is stale | "Someone changed this" with the latest version |
| `PRECONDITION_REQUIRED` | 428 | `If-Match` missing on a versioned write | Developer error, fixed in code |
| `PLAN_RULE_VIOLATION` | 422 | An edit breaks a hard rule | Inline violations with Suggest fixes |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different body | Developer error |
| `PAYLOAD_TOO_LARGE` | 413 | Upload or batch over its limit | Retry in smaller parts |
| `RATE_LIMITED` | 429 | Too many requests; `Retry-After` set | Wait message |
| `INTERNAL` | 500 | Anything unexpected | Generic message with the request id to quote |
| `DEPENDENCY_UNAVAILABLE` | 503 | Redis, storage or a provider is down; `Retry-After` set | Retry later |

### Domain errors

Services throw `DomainError` subclasses from `core/errors`. One filter maps them to problem+json. Never build problem JSON by hand, and never catch a domain error in a controller.

| Class | Code | Status | Notes |
| --- | --- | --- | --- |
| `ValidationError` | `VALIDATION_FAILED` | 400 | Takes field errors: `[{ field, code, message }]` |
| `ForbiddenError` | `FORBIDDEN` | 403 | `PermissionGuard` also answers 403 before the controller runs |
| `NotFoundError` | `NOT_FOUND` | 404 | Also thrown for rows outside the actor's scope |
| `StateConflictError` | `CONFLICT_STATE` | 409 | State machine refusal or duplicate |
| `CutoffPassedError` | `CUTOFF_PASSED` | 409 | |
| `PlanLockedError` | `PLAN_LOCKED` | 409 | |
| `VersionMismatchError` | `VERSION_MISMATCH` | 412 | Thrown by the service when a versioned update returns no row |
| `PreconditionRequiredError` | `PRECONDITION_REQUIRED` | 428 | Thrown by `@IfMatch()` when the header is missing |
| `RuleViolationError` | `PLAN_RULE_VIOLATION` | 422 | Carries `violations` |

- `assertTransition(machine, status, event)` answers 409 `CONFLICT_STATE`.
- Out-of-scope rows answer 404; missing permissions answer 403.
- The spec names no class for `UNAUTHENTICATED`, `IDEMPOTENCY_KEY_REUSED`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL` or `DEPENDENCY_UNAVAILABLE` (see Open questions).

### Status codes by request

| Request | Success | Typical failures |
| --- | --- | --- |
| GET one | 200, or 304 with `If-None-Match` | 404 |
| GET list | 200 | 400 |
| POST create | 201 with `Location` | 400, 409, 422 |
| POST action | 200 with the updated resource | 409, 412, 422, 428 |
| PATCH | 200 | 400, 409, 412, 428 |
| DELETE draft | 204 | 409 |
| POST batch (sync, pings) | 200 with a result per item | 400 only when the envelope itself is invalid |

A batch never fails as a whole because of one bad item. It answers `results: [{ clientUuid, status: 'applied' | 'duplicate' | 'conflict' | 'rejected', code? }]`.

### The filter

```ts
// apps/backend/src/core/http/problem-details.filter.ts (excerpt)
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly cls: ClsService, @InjectPinoLogger('http') private readonly log: PinoLogger) {}

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const problem = toProblem(err, this.cls.getId());  // DomainError, HttpException, Postgres errors, zod, unknown
    if (problem.status >= 500) this.log.error({ err, requestId: problem.requestId }, 'unhandled error');
    res.status(problem.status).type('application/problem+json').json(problem);
  }
}
// Postgres mapping, from err.cause.code on a DrizzleQueryError: 23505 unique or 23503 foreign key → 409 CONFLICT_STATE;
// 23514 check → 400 VALIDATION_FAILED naming the constraint; 42501 row-level security → 403 FORBIDDEN.
// A versioned update that returns no row is thrown as 412 VERSION_MISMATCH by the service itself.
```

## 4. Pagination, filtering and sorting

Tables use offset pages because the Compass Pagination component shows page numbers and totals. Feeds that grow while someone reads them use cursors, so rows never repeat or go missing.

| Kind | Used by | Parameters | Meta |
| --- | --- | --- | --- |
| Offset | Tables: orders, vehicles, outlets, users, deferrals, flags, issues, alerts | `limit` (default 10, max 100), `offset` | `page: { limit, offset, total }` |
| Cursor | Feeds: audit events, notifications, pings, stop events, sync changes | `limit` (default 50, max 200), `cursor` | `page: { limit, nextCursor, hasMore }` |

A cursor is base64url JSON of the last row's sort value and id, validated on the way in. A tampered cursor answers 400.

- **Filters.** `filter[field]=a,b` means any of. `filter[field][op]=value` supports `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains` (case-insensitive) and `null` (true or false). Only fields the resource spec lists are accepted; any other answers 400 naming the field.
- **Search.** `q` searches the resource's text fields, such as order number and outlet name.
- **Sort.** `sort=-submittedAt,orderNo`, with `-` for descending, from a whitelist. Every resource has a default, and `id` is always appended as the tiebreaker.
- **Include.** `include=lines,outlet` fills `_embedded`, one level deep, from a whitelist.
- **Totals** use `count(*)` with the same filter, which is cheap at Waypoint's volumes (about 150 orders per depot per day). Feeds return no total.

| Screen | Request |
| --- | --- |
| 03 Order queue | `GET /orders?filter[depotId]=PLG&filter[deliveryDate]=2026-10-02&filter[status]=CONFIRMED&sort=districtId,orderNo&limit=25` |
| M3 Order history | `GET /orders?filter[requestedDate][gte]=2026-09-01&sort=-requestedDate&limit=10&offset=0` |
| A1 Users | `GET /users?filter[role]=driver&q=aniqa&limit=10` |
| 23 Deferral history | `GET /deferrals?filter[outletId]=OUT014&sort=-createdAt&limit=10` |
| Audit feed (timelines, 23) | `GET /audit-events?filter[action]=planning.plan.published&filter[recordedAt][gte]=2026-10-01T00:00:00%2B05:30&limit=50` |
| 02 Notifications | `GET /me/notifications?limit=20&cursor=eyJrIjoi...` |

The whitelists live in the module's `ResourceSpec` (section 7).

## 5. Concurrency and idempotency

Two dispatchers editing one plan, a double-tapped button and a phone replaying its outbox all end the same way: one change applies, and the others get a clear answer instead of a silent overwrite.

- **Versions.** Every mutable aggregate has `version`. Responses send `ETag: W/"<version>"`. Writes to orders, plans, trips, stops and vehicles need `If-Match` (428 without it, 412 when stale). Updates filter on `and(eq(t.id, id), eq(t.version, v))`, set `version = version + 1` and call `.returning()`; no row back means `VersionMismatchError` (412).
- **Plan edits** carry the plan's version, and every edit bumps it, so two dispatchers can't interleave moves on one plan. The loser sees the latest plan and redoes one step.
- **Conditional reads.** `If-None-Match` answers 304, which saves mobile data when a screen polls.
- **Idempotency keys.** Creates and non-repeatable actions send `Idempotency-Key`, which the web generates once per button press. The server keeps key, user, method, path, request hash, status and body for 24 hours.
    - The same key and body return the stored response with `Idempotent-Replayed: true`.
    - The same key with a different body answers 422 `IDEMPOTENCY_KEY_REUSED`.
    - A duplicate still in flight answers 409 with `Retry-After: 1`.
- **Offline events** carry a device-made `clientUuid`, so replays hit a unique constraint and come back as duplicates. They also carry the stop or trip version the device saw. When the server's state makes an event impossible (stop cancelled, trip reassigned), the event becomes a sync conflict for 19c instead of applying. Events from one device apply in `deviceSeq` order.

| Operation | `If-Match` | `Idempotency-Key` | `clientUuid` |
| --- | --- | --- | --- |
| Create order, template, invitation, user | — | Yes | — |
| Edit order or lines | Yes | — | — |
| Submit or cancel an order | Yes | Yes | — |
| Engine run, plan edit, publish, revise, close | Yes (plan) | Yes | — |
| Reassign or re-sequence a trip | Yes (trip) | Yes | — |
| Confirm receipt, report an issue | Yes (order) | Yes | — |
| Loader checks, flags, release | — | — | Yes |
| Driver stop events and proof of delivery | — | — | Yes |
| Position pings | — | — | Deduped on `(vehicleId, recordedAt)` |

### Headers at a glance

| Header | Direction | Meaning |
| --- | --- | --- |
| `ETag: W/"<version>"` | Response | Current version of a versioned resource |
| `If-Match: W/"<version>"` | Request | Required on versioned writes; any other format is 400 |
| `If-None-Match` | Request | Conditional read; 304 when unchanged |
| `Idempotency-Key` | Request | One per button press on creates and non-repeatable actions |
| `Idempotent-Replayed: true` | Response | This is the stored response for a repeated key |
| `Retry-After` | Response | Sent with 429, 503, and 409 for an in-flight duplicate |
| `Location` | Response | URL of the resource a 201 created |
| `x-request-id` | Request | Request id; Caddy adds it if missing; it comes back as `meta.requestId` and a problem's `requestId` |
| `x-correlation-id` | Request | Ties a request to its jobs, notifications and audit rows; created when absent |
| `x-device-id` | Request | Device id, sent by the web client on every call |

## 6. Controller template and request lifecycle

Controllers look the same everywhere: decorators for permission, OpenAPI and headers, then one call into a service and one into the link builder.

### Request lifecycle

A request passes nine fixed steps. Each use case runs in one transaction that holds the domain write, its audit row and its outbox event, so none can exist without the others.

1. Caddy terminates TLS, adds `x-request-id` if missing and forwards `/api/*` to Nest.
2. The nestjs-cls middleware opens a context with the request id, a correlation id (`x-correlation-id` or new) and the device id (`x-device-id`).
3. BetterAuth's global `AuthGuard` resolves the session from the cookie (a bearer token later). `@AllowAnonymous()` routes skip it.
4. `ActorGuard` builds the `Actor` (id, role, depotId, outletId, vehicleId, deviceId, name) into CLS and the logger context.
5. `PermissionGuard` checks `@RequirePermission('order:submit')` against the shared matrix and answers 403 when it fails.
6. `ValidationPipe` (whitelist, forbidNonWhitelisted, transform) checks the DTO and answers 400 on failure.
7. `ActorTransactionInterceptor` opens one transaction for the request and stamps the actor for row-level security. The service method's `@Transactional()` joins that transaction.
8. `EnvelopeInterceptor` wraps the result as `{ data, meta, _links }`, sets `ETag` and stores idempotent responses.
9. `ProblemDetailsFilter` turns any error into `application/problem+json`, and pino-http writes one access line.

| Layer | Does | Never does |
| --- | --- | --- |
| Controller | Route, `@RequirePermission`, DTO validation, `@Actor()`, `If-Match`, maps the result through the LinkBuilder | Touch the database, hold business rules, catch domain errors |
| Command service | One public method per use case under `@Transactional()`: load, check scope, state machine and rules, write, `audit.record()`, `outbox.add()`, log one event | Return HTTP types, reach into another module's internals, swallow errors |
| Query service | Reads with `scope.where(actor)`, filters, sorting, pagination | Write, or skip the scope |

### Controller

```ts
// modules/ordering/controllers/orders.controller.ts
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly queries: OrderQueries,
    private readonly orders: OrdersService,
    private readonly links: OrderLinks,
  ) {}

  @Get()
  @RequirePermission('order:read')
  @ApiPaginated(OrderDto, { resource: ORDER_RESOURCE })
  async list(@Query() query: ListQueryDto, @Actor() actor: Actor, @Req() req: Request) {
    const page = await this.queries.list(query, actor);
    return this.links.page(page, actor, req, {
      create: can(actor, 'order:create') && { href: '/api/v1/orders', method: 'POST', title: 'New order' },
    });
  }

  @Get(':id')
  @RequirePermission('order:read')
  @ApiResource(OrderDto)
  async get(@Param('id', ParseUUIDPipe) id: string, @Query() q: IncludeQueryDto, @Actor() actor: Actor) {
    return this.links.one(await this.queries.get(id, actor, q.include), actor);
  }

  @Post()
  @RequirePermission('order:create')
  @UseIdempotency()
  @ApiResource(OrderDto, { status: 201 })
  async create(@Body() dto: CreateOrderDto, @Actor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    const order = await this.orders.createDraft(dto, actor);
    res.location(`/api/v1/orders/${order.id}`);                   // POST defaults to 201
    return this.links.one(order, actor);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('order:submit')
  @UseIdempotency()
  @ApiResource(OrderDto)
  @ApiProblems(409, 412, 428)
  async submit(@Param('id', ParseUUIDPipe) id: string, @IfMatch() version: number, @Actor() actor: Actor) {
    return this.links.one(await this.orders.submit(id, actor, version), actor);
  }
}
```

```ts
// core/http/decorators.ts (excerpt)
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

export const Actor = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().actor);

export const IfMatch = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const raw = ctx.switchToHttp().getRequest<Request>().header('if-match');
  if (!raw) throw new PreconditionRequiredError();                            // 428
  const match = /^W\/"(\d+)"$/.exec(raw.trim());
  if (!match) throw new ValidationError([{ field: 'If-Match', code: 'format', message: 'Expected W/"<version>"' }]);
  return Number(match[1]);
});

export const ApiPaginated = <T extends Type<unknown>>(model: T, opts: { resource?: ResourceSpec } = {}) =>
  applyDecorators(
    ApiExtraModels(model, PageMetaDto, LinkDto),
    ...listQueryParams(opts.resource),                 // limit, offset or cursor, filter[...], sort, q, include
    ApiOkResponse({ schema: {
      type: 'object', required: ['data', 'meta', '_links'],
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(model) } },
        meta: { $ref: getSchemaPath(PageMetaDto) },
        _links: { type: 'object', additionalProperties: { $ref: getSchemaPath(LinkDto) } },
      },
    } }),
    ApiProblems(400, 401, 403),
  );

export const ApiResource = <T extends Type<unknown>>(model: T, opts: { status?: 200 | 201 } = {}) =>
  applyDecorators(
    ApiExtraModels(model, MetaDto),
    ApiResponse({ status: opts.status ?? 200, schema: {
      type: 'object', required: ['data', 'meta'],
      properties: { data: { $ref: getSchemaPath(model) }, meta: { $ref: getSchemaPath(MetaDto) } },
    } }),
    ApiProblems(400, 401, 403, 404),
  );
```

Every response DTO declares `_links` as a map of `LinkDto`. `ApiProblems()` adds `application/problem+json` responses that reference `ProblemDto`, so the generated client knows the error shape too.

### Permissions

Permission strings are `<resource>:<action>`. The matrix lives in `packages/shared/src/auth/permissions.ts`, so the API guard and the web app read the same object: `@RequirePermission('plan:publish')` becomes `roles[actor.role].authorize({ plan: ['publish'] })`.

| Resource | Actions |
| --- | --- |
| `order` | read, create, update, submit, cancel, queue |
| `catalog` | read, manage |
| `plan` | read, build, publish, revise, close |
| `deferral` | read, decide, respond |
| `trip` | read, reassign, resequence |
| `load` | read, check, flag, release, decide |
| `stop` | read, record |
| `receipt` | read, confirm |
| `issue` | read, create, resolve |
| `alert` | read, act |
| `tracking` | read |
| `forecast` | read, manage |
| `masterData` | read, manage |
| `audit` | read, export |
| `settings` | read, manage |
| `webhook` | manage |
| `simulation` | run |

The statement also spreads in BetterAuth's `defaultStatements`. Which role holds which action is set by `roles` in the same file.

## 7. The generic CRUD layer

A small kernel in `core/persistence` and `core/http` gives every resource the same list, get, paging, filters, envelope and links. A module declares a `ResourceSpec`, a `LinkBuilder` and its scope, and writes only its business logic.

```ts
// core/persistence/resource-spec.ts
export interface ResourceSpec<TTable extends PgTable = PgTable> {
  name: string;                                        // "orders"
  table: TTable;                                       // orders (for counts and cursors)
  queryKey: keyof Db['query'];                         // 'orders' (the relational query that supports `with`)
  filters: Record<string, FilterSpec>;                 // { status: enumFilter(orders.status), deliveryDate: dateFilter(orders.deliveryDate) }
  sorts: Record<string, AnyPgColumn>;                  // { submittedAt: orders.submittedAt }
  defaultSort: string;                                 // "-submittedAt"
  search?: (q: string) => SQL | undefined;             // order number and outlet name, case-insensitive
  includes?: Record<string, object>;                   // { lines: { lines: true } } becomes the query's `with`
  pagination: 'offset' | 'cursor';
  maxLimit?: number;
}

// modules/ordering/order.resource.ts
export const ORDER_RESOURCE = {
  name: 'orders', table: orders, queryKey: 'orders', pagination: 'offset', defaultSort: '-submittedAt',
  filters: { status: enumFilter(orders.status), tempClass: enumFilter(orders.tempClass), depotId: textFilter(orders.depotId),
             outletId: textFilter(orders.outletId), deliveryDate: dateFilter(orders.deliveryDate),
             requestedDate: dateFilter(orders.requestedDate) },
  sorts: { submittedAt: orders.submittedAt, orderNo: orders.orderNo, districtId: orders.districtId },
  search: (q) => or(ilike(orders.orderNo, contains(q)),
    sql`EXISTS (SELECT 1 FROM ${outlets} WHERE ${outlets.id} = ${orders.outletId} AND ${outlets.name} ILIKE ${contains(q)})`),
  includes: { lines: { lines: true }, outlet: { outlet: { columns: { id: true, name: true } } } },
} satisfies ResourceSpec<typeof orders>;
// contains(q) escapes % and _ and wraps the text in %...%
```

```ts
// core/persistence/crud-query.service.ts
@Injectable()
export class CrudQueryService {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  async list<T extends { id: string }>(spec: ResourceSpec, query: ListQuery, scope?: SQL): Promise<Page<T>> {
    const tx = this.txHost.tx;
    const where = and(scope, buildWhere(spec, query.filter), query.q && spec.search ? spec.search(query.q) : undefined);
    const orderBy = buildOrderBy(spec, query.sort);          // asc()/desc() columns, id appended as the tiebreaker
    const limit = clampLimit(query.limit, spec);
    const withArg = buildWith(spec, query.include);
    const finder = this.finder<T>(spec);

    if (spec.pagination === 'offset') {
      const offset = query.offset ?? 0;
      const [items, total] = await Promise.all([
        finder.findMany({ where, orderBy, limit, offset, with: withArg }),
        tx.$count(spec.table, where),
      ]);
      return { items, page: { kind: 'offset', limit, offset, total } };
    }

    const after = query.cursor ? decodeCursor(query.cursor) : undefined;       // { k: last sort value, id: last id }
    const rows = await finder.findMany({
      where: and(where, after ? afterCursor(spec, query.sort, after) : undefined), orderBy, limit: limit + 1, with: withArg });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const hasMore = rows.length > limit;
    return { items, page: { kind: 'cursor', limit, hasMore,
      nextCursor: hasMore && last ? encodeCursor(sortValue(last, spec, query.sort), last.id) : null } };
  }

  async get<T>(spec: ResourceSpec, id: string, scope?: SQL, include?: string[]): Promise<T> {
    const row = await this.finder<T>(spec).findFirst({ where: and(eq(idColumn(spec), id), scope), with: buildWith(spec, include) });
    if (!row) throw new NotFoundError(spec.name, id);          // out of scope is also 404
    return row;
  }

  // The kernel is the one place with loose typing (the relational query looked up by key);
  // its inputs and outputs stay strict.
  private finder<T>(spec: ResourceSpec) { return this.txHost.tx.query[spec.queryKey] as unknown as RelationalFinder<T>; }
}

// Keyset cursor: (sort column, id) after the last row, in the sort's direction
const afterCursor = (spec: ResourceSpec, sort: string | undefined, after: Cursor): SQL => {
  const { column, dir } = primarySort(spec, sort);
  return dir === 'asc'
    ? sql`(${column}, ${idColumn(spec)}) > (${after.k}, ${after.id})`
    : sql`(${column}, ${idColumn(spec)}) < (${after.k}, ${after.id})`;
};
```

```ts
// core/http/links.ts
export abstract class LinkBuilder<T extends { id: string }> {
  protected abstract readonly clock: ClockService;
  protected abstract self(row: T): string;
  protected abstract actions(row: T, actor: Actor, now: Date): Record<string, Link | false>;
  protected present(row: T): object { return row; }                // override to shape the response DTO

  one(row: T, actor: Actor): Resource<T> {
    const links = { self: { href: this.self(row) }, ...compact(this.actions(row, actor, this.clock.now())) };
    return { ...this.present(row), _links: links } as Resource<T>;
  }

  page(p: Page<T>, actor: Actor, req: Request, extra: Record<string, Link | false> = {}): Collection<T> {
    return { items: p.items.map((r) => this.one(r, actor)), page: p.page, links: { ...pageLinks(req, p.page), ...compact(extra) } };
  }
}

// modules/ordering/policies/order.links.ts
@Injectable()
export class OrderLinks extends LinkBuilder<OrderRow> {
  constructor(protected readonly clock: ClockService, private readonly rules: OrderRules) { super(); }
  protected self = (o: OrderRow) => `/api/v1/orders/${o.id}`;
  protected actions(o: OrderRow, actor: Actor, now: Date) {
    const base = `/api/v1/orders/${o.id}`;
    return {
      lines: { href: `${base}/lines` },
      timeline: { href: `/api/v1/timelines/order/${o.id}` },
      submit: this.rules.canSubmit(o, actor, now) && { href: `${base}/submit`, method: 'POST', title: 'Send order', requires: ['If-Match'] },
      edit: this.rules.canEdit(o, actor, now) && { href: base, method: 'PATCH', title: 'Edit order', requires: ['If-Match'] },
      cancel: this.rules.canCancel(o, actor, now) && { href: `${base}/cancel`, method: 'POST', title: 'Cancel order', requires: ['If-Match', 'reasonNote'] },
      reorder: this.rules.canReorder(o, actor) && { href: `${base}/reorder`, method: 'POST', title: 'Reorder' },
    };
  }
}
// OrderRules.canSubmit = orderMachine.can(o.status, 'SUBMIT') && can(actor, 'order:submit') && inScope(o, actor) && timeAllows(o, now)
// OrdersService.submit() calls the same function, so the link and the server always agree.
```

```ts
// core/http/envelope.interceptor.ts
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService, private readonly clock: ClockService) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(map((out) => {
      if (out === undefined || res.statusCode === 204) return out;
      const meta = { requestId: this.cls.getId(), serverTime: this.clock.now().toISOString(), apiVersion: API_VERSION,
                     ...(this.cls.get('notices')?.length && { notices: this.cls.get('notices') }) };
      if (isCollection(out)) return { data: out.items, meta: { ...meta, page: out.page }, _links: out.links };
      if (typeof out?.version === 'number') res.setHeader('ETag', `W/"${out.version}"`);
      return { data: out, meta };
    }));
  }
}
```

```ts
// core/persistence/simple-crud.commands.ts: master data with no lifecycle (outlets, depots, items, reasons)
export abstract class SimpleCrudCommands<TTable extends VersionableTable, TCreate, TUpdate> {
  protected abstract readonly table: TTable;
  protected abstract readonly entityType: string;
  protected abstract toValues(dto: TCreate): TTable['$inferInsert'];
  protected abstract toChanges(dto: TUpdate): Partial<TTable['$inferInsert']>;
  constructor(protected readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>,
              protected readonly audit: AuditService, protected readonly outbox: OutboxService) {}

  @Transactional()
  async create(dto: TCreate): Promise<TTable['$inferSelect']> {
    const [row] = await this.txHost.tx.insert(this.table).values(this.toValues(dto)).returning();
    await this.audit.record({ action: `${this.entityType}.created`, entity: [this.entityType, String(row.id)], after: row });
    await this.outbox.add(`${this.entityType}.created`, { v: 1, id: row.id }, { aggregate: [this.entityType, String(row.id)] });
    return row;
  }

  @Transactional()
  async update(id: string, dto: TUpdate, version?: number): Promise<TTable['$inferSelect']> {
    const t = this.table;
    const [before] = await this.txHost.tx.select().from(t).where(eq(t.id, id));
    if (!before) throw new NotFoundError(this.entityType, id);
    const [row] = await this.txHost.tx.update(t)
      .set({ ...this.toChanges(dto), ...(t.version && { version: sql`${t.version} + 1` }) })
      .where(and(eq(t.id, id), version != null && t.version ? eq(t.version, version) : undefined))
      .returning();
    if (!row) throw new VersionMismatchError(this.entityType, id);
    await this.audit.record({ action: `${this.entityType}.updated`, entity: [this.entityType, id], before, after: row });
    await this.outbox.add(`${this.entityType}.updated`, { v: 1, id }, { aggregate: [this.entityType, id] });
    return row;
  }
}
// VersionableTable = a PgTable with an id column and, optionally, a version column.
```

Resources with a lifecycle (orders, plans, trips, stops, deferrals) never use `SimpleCrudCommands`. Each of their writes is an explicit use case with its own state check and audit reason.

## 8. DTOs, validation and mappers

Each layer has its own shape, with small pure mappers between them. One shared class for all three would leak internal fields such as `pinHash` and scope columns, and would let a client set `depotId` on an order.

| Layer | Shape | Where it comes from |
| --- | --- | --- |
| Database | `OrderRow = typeof orders.$inferSelect`, `NewOrder = typeof orders.$inferInsert` | Inferred from the schema; nothing to write or generate |
| HTTP | `CreateOrderDto`, `OrderDto` classes | class-validator and `@ApiProperty`; OpenAPI and orval read these |
| Engine | `EngineInput`, `EngineOrder`, `EngineTrip` | `packages/engine`, plain types with no framework imports |

Validation happens in three places, each catching what the others can't:

1. The DTO checks shape (types, ranges, formats) and runs first.
2. The service checks business rules (transitions, cutoff, scope, engine rules).
3. The database is the last line (composite keys, checks, unique indexes, row-level security). It fires only if both of the others missed something.

```ts
// modules/ordering/dto/create-order.dto.ts
export class CreateOrderLineDto {
  @IsUUID(7) @ApiProperty({ format: 'uuid' }) itemId!: string;
  @IsInt() @Min(1) @Max(9999) @ApiProperty({ example: 12 }) qty!: number;
}

export class CreateOrderDto {
  @IsIn(tempClassEnum.enumValues)
  @ApiProperty({ enum: tempClassEnum.enumValues, enumName: 'TempClass' })
  tempClass!: TempClass;

  @IsISO8601({ strict: true }) @Length(10, 10)
  @ApiProperty({ example: '2026-10-02', description: 'Business date, Asia/Colombo' })
  requestedDate!: string;

  @ValidateNested({ each: true }) @Type(() => CreateOrderLineDto) @ArrayMinSize(1) @ArrayMaxSize(200)
  @ApiProperty({ type: [CreateOrderLineDto] })
  lines!: CreateOrderLineDto[];

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
// outletId, depotId, brand and districtId are not on the DTO: the service takes them from the actor's scope.
export class UpdateOrderDto extends PartialType(PickType(CreateOrderDto, ['requestedDate', 'lines', 'note'])) {}
```

```ts
// modules/ordering/order.mapper.ts: pure functions, unit-tested, no DI
export type OrderRow = typeof orders.$inferSelect;
export type OrderWithRelations = OrderRow & { lines: OrderLineRow[]; outlet: Pick<OutletRow, 'id' | 'name'> };

export const toOrderDto = (o: OrderWithRelations): OrderDto => ({
  id: o.id, orderNo: o.orderNo, status: o.status, tempClass: o.tempClass,
  outlet: { id: o.outlet.id, name: o.outlet.name },
  requestedDate: o.requestedDate,          // already 'YYYY-MM-DD': business dates are strings end to end
  deliveryDate: o.deliveryDate,
  submittedAt: o.submittedAt?.toISOString() ?? null,
  units: o.units, weightKg: o.weightKg, volumeM3: o.volumeM3,
  lines: o.lines.map(toOrderLineDto),
  version: o.version,                      // echoed as the ETag, never read from the body
});

export const toOrderInsert = (dto: CreateOrderDto, actor: StoreActor, outlet: OutletRow, orderNo: string): NewOrder => ({
  orderNo, outletId: outlet.id, depotId: outlet.depotId, brand: outlet.brand, districtId: outlet.districtId,
  tempClass: dto.tempClass, requestedDate: dto.requestedDate, deliveryDate: dto.requestedDate,
  note: dto.note ?? null, placedById: actor.id, source: 'web',
});
```

| Mapper | From → to | Used by |
| --- | --- | --- |
| `toXDto` | Row (plus relations) → response DTO | Every controller response |
| `toXInsert` | Request DTO + actor scope → insert values | Command services |
| `toEngineInput` | Rows for one depot and date → `EngineInput` | `EngineRunner`, plan editor validation |
| `fromEngineOutput` | `EngineOutput` → trip, stop and deferral inserts | `EngineRunner` |
| `toAuditSnapshot` | Row → the audited fields only | `audit.record()` before and after |
| `toEventPayload` | Row → versioned outbox payload (`v: 1`) | `outbox.add()` |
| `toOfflineBundle` | Trip, stops, lines, outlets → the phone's bundle | `GET /drivers/me/trips/today` |
| `fromFieldEvent` | Validated sync event → `stop_events` insert | Sync ingest |
| `toCsvRow` | Row → export columns | CSV exports, Task 2B export |

Gotchas:

- **Express 5's query parser.** Nest 11 on Express 5 parses `?filter[status]=A` flat by default. `main.ts` sets `app.set('query parser', 'extended')` before the global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- **Unions are zod, not classes.** Sync events and plan `EditOp`s are discriminated unions that class-validator handles badly. They are zod schemas in `packages/shared`, parsed by a `ZodPipe` on those two endpoints, and orval gets them through a hand-written `@ApiBody` schema.
- **drizzle-zod for imports.** The CSV and seed importers validate each row with `createInsertSchema(outlets)` (and friends) before inserting, so a bad row names its column instead of failing in Postgres.
- **Enum drift test.** A unit test asserts every DTO enum and every `packages/shared` constant equals its Postgres enum's `enumValues`.

## 9. OpenAPI and the typed client (orval)

The OpenAPI document is the contract. The API writes it from its decorators, orval turns it into React Query hooks, zod schemas and MSW mocks, and nobody hand-writes a request in the web app.

```ts
// packages/api-client/orval.config.ts
import { defineConfig } from 'orval';

export default defineConfig({
  compass: {
    input: { target: '../../apps/backend/openapi.json' },
    output: {
      mode: 'tags-split',
      target: 'src/gen/endpoints',
      schemas: 'src/gen/model',
      client: 'react-query',
      httpClient: 'fetch',
      headers: true,                                   // If-Match and Idempotency-Key become typed parameters
      mock: { type: 'msw', delay: 300, useExamples: true },
      clean: true,
      override: {
        mutator: { path: 'src/mutator.ts', name: 'compassFetch' },
        query: { signal: true },
      },
    },
  },
  compassZod: {
    input: { target: '../../apps/backend/openapi.json' },
    output: { mode: 'tags-split', client: 'zod', target: 'src/gen/zod', fileExtension: '.zod.ts' },
  },
});
```

```ts
// packages/api-client/src/mutator.ts
export class ApiProblem extends Error {
  constructor(readonly problem: Problem, readonly status: number) { super(problem.title); }
}

export const compassFetch = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('x-device-id', getDeviceId());
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && !headers.has('Idempotency-Key')) headers.set('Idempotency-Key', crypto.randomUUID());

  const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ''}${url}`, { ...init, headers, credentials: 'include' });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    if (res.status === 401) authEvents.emit('unauthenticated');           // sign-in screen; offline sync pauses
    throw new ApiProblem(body ?? { title: res.statusText, status: res.status, code: 'INTERNAL' }, res.status);
  }
  syncServerClock(body?.meta?.serverTime);                                // feeds useServerClock()
  return body as T;
};

export type ErrorType<E> = ApiProblem;
export type BodyType<B> = B;
```

- **Keys per press.** `<Action>` (Step 8) makes one `Idempotency-Key` per press and passes it in, so React Query retries reuse it. The mutator fills one in only when none came.
- **`pnpm api:gen`** runs the API's `openapi:write` script (boots Nest without listening, writes `openapi.json`, exits) and then orval.
- **CI** re-runs `api:gen` and fails on any diff, so nobody forgets to regenerate. `oasdiff breaking` against `main` comments on breaking changes.
- **Mocks.** The generated `*.msw.ts` handlers are combined in `apps/frontend/src/mocks/handlers.ts`. Paths listed in `apps/frontend/src/mocks/live.ts` go to the real API. Mock data comes from the `@ApiProperty({ example })` values, so good DTO examples double as demo data.
- **Query defaults.** Queries retry once, never on 4xx. Mutations never retry automatically.
- **Generated code** in `packages/api-client/src/gen` is never edited by hand; regenerate it.

## 10. Versioning and limits

The spec fixes these points and no more (see Open questions).

- **API version.** The path carries the major version (`/api/v1`). Every envelope carries `meta.apiVersion` (`"1.0.0"`). Breaking changes show up as `oasdiff breaking` comments on the PR.
- **Event payloads** in outbox events carry their own version (`v: 1`).
- **Page sizes.** Offset lists: `limit` default 10, max 100. Cursor feeds: `limit` default 50, max 200.
- **Idempotency records** are kept for 24 hours.
- **Rate limits.** Over a limit, the API answers 429 `RATE_LIMITED` with `Retry-After`. BetterAuth limits the auth routes: 100 requests per 60 s by default, `/sign-in/email` 10 per 60 s, `/sign-in/pin` 5 per 60 s, `/phone-number/send-otp` 3 per 300 s. `POST /api/v1/client-logs` accepts 50 per minute per device.
- **Payload size.** An upload or batch over its limit answers 413 `PAYLOAD_TOO_LARGE`. Webhook bodies on `/api/v1/webhooks` are read raw, up to 1 MB.

## Checklist for a new endpoint

This mirrors the `rest-endpoint` skill.

- [ ] Route: plural kebab-case noun under `/api/v1`; a state change is `POST /{resource}/{id}/{verb}`; natural keys stay natural (section 1).
- [ ] DTOs in `dto/`: request classes with class-validator and `@ApiProperty` examples; response DTOs mirror the API fields, never Drizzle row types; scope fields such as `outletId` and `depotId` are never on a request DTO (section 8).
- [ ] Read in `<m>.queries.ts` through `CrudQueryService` and the module's `ResourceSpec`, always with `this.scope.where(actor)`; offset for tables, cursor for feeds (sections 4 and 7).
- [ ] Write in `<m>.service.ts` under `@Transactional()`: load in scope, `assertTransition`, rules, versioned update, `audit.record` (with a reason code where the action needs one), `outbox.add`, one log line.
- [ ] Links in `policies/<m>.links.ts`: an action link only when state, permission, scope and time all allow it, using the same `can*()` helper as the service (section 2).
- [ ] Controller is thin: `@RequirePermission('<resource>:<action>')`, `@Actor()`, `@IfMatch()` on versioned writes, `@UseIdempotency()` on creates and non-repeatable actions, `@ApiResource(Dto)` or `@ApiPaginated(Dto)`, `@ApiProblems(...)`; returns `links.one()` or `links.page()` (section 6).
- [ ] Status codes: 200 for reads and actions (`@HttpCode(200)` on action POSTs), 201 with `Location` for creates, 204 for deleting drafts (section 3).
- [ ] Errors: only `DomainError` subclasses; no problem JSON built by hand (section 3).
- [ ] Tests in `__tests__/<resource>.e2e.spec.ts`: the happy path; each refused role (403); each out-of-scope actor (404); a stale `If-Match` (412); an invalid body (400 with field errors); `_links` present and absent in the right states.
- [ ] Contract: `pnpm api:gen`, commit `openapi.json`, and check the diff shows only what you meant (section 9).
- [ ] Spec: tick the acceptance criteria in `specs/<module>/spec.md` and list the endpoint there.
- [ ] No db or schema import in the controller.
- [ ] Audit row and outbox event in the same transaction as the write.
- [ ] `pnpm check` green.

## Open questions

- **Idempotency decorator, pagination helpers, If-Match.** The Build Spec's Step 3 text names `@IdempotencyKey()` on creates, `paginateOffset`/`paginateCursor`, and a version check only when `If-Match` is present. Step 4 has `@UseIdempotency()` on creates and non-repeatable actions, `CrudQueryService.list()` choosing offset or cursor from `ResourceSpec.pagination`, and a required `If-Match` (428 when missing). This file, the `rest-endpoint` and `contract-first` skills and `apps/backend/CLAUDE.md` follow Step 4; update Step 3 in the Build Spec to match.
- **Order lines verb.** Step 4 says PUT replaces a whole line set, but its validation example is `PATCH /api/v1/orders/{id}/lines`. Pick one.
- **In-flight duplicate.** A duplicate `Idempotency-Key` still in flight answers 409 with `Retry-After: 1`, but Step 4 names no problem code for it.
- **Error classes.** Step 2 names eight `DomainError` subclasses and Step 4 adds `PreconditionRequiredError`. No class is named for `UNAUTHENTICATED`, `IDEMPOTENCY_KEY_REUSED`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL` or `DEPENDENCY_UNAVAILABLE`. The class-to-code pairs in section 3 are read from the class names; confirm them in `core/errors`.
- **Storing idempotent responses.** Step 2 says `EnvelopeInterceptor` stores them. Step 4's interceptor excerpt does not, which suggests `@UseIdempotency()` does. Confirm where it happens.
- **Rate limits and versioning.** Step 4 defines `RATE_LIMITED` (429) but no API-wide limit; only the auth limits and the client-log limit exist. It also sets no rule for when a change needs `/api/v2` or a new `apiVersion`.

## Changelog

- 2026-09-30 created from the Build Spec
