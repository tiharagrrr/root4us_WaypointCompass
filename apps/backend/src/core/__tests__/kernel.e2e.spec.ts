import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { type Actor as SignedInActor, can } from '@waypoint/shared';
import { IsNumber, IsString, Length, Min } from 'class-validator';
import { eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { Request, Response as ExpressResponse } from 'express';
import request, { type Response } from 'supertest';
import { bodyOf, browser, type Problem, signedInAs } from '../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../test/create-test-app';
import { depotFixture, suffix } from '../../../test/fixtures';
import { expectProblem, freezeClock } from '../../../test/kernel';
import type { Database } from '../../db/client';
import { vehicles } from '../../db/schema';
import { ClockService } from '../clock/clock.service';
import { StateConflictError } from '../errors/domain-errors';
import { IncludeQueryDto, ListQueryDto } from '../http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiResource,
  IfMatch,
  RequirePermission,
  UseIdempotency,
} from '../http/decorators';
import { LinkBuilder, type LinkMap } from '../http/links';
import { buildOpenApiDocument } from '../http/openapi';
import { CrudQueryService } from '../persistence/crud-query.service';
import type { AuditEntry, EventRouting } from '../persistence/ports';
import {
  contains,
  enumFilter,
  instantFilter,
  numberFilter,
  type ResourceSpec,
  textFilter,
} from '../persistence/resource-spec';
import { SimpleCrudCommands } from '../persistence/simple-crud.commands';
import type { StampedDrizzleAdapter } from '../persistence/transactions';

/*
 * An example resource built only from the kernel, the way a module builds
 * one: a ResourceSpec, a LinkBuilder, SimpleCrudCommands and a thin
 * controller. It serves the vehicles table under /api/v1/example-vehicles.
 */

type VehicleRow = typeof vehicles.$inferSelect;

const VEHICLES = {
  name: 'vehicles',
  table: vehicles,
  queryKey: 'vehicles',
  pagination: 'offset',
  defaultSort: 'code',
  filters: {
    depotId: textFilter(vehicles.depotId),
    status: enumFilter(vehicles.status),
    temp: enumFilter(vehicles.temp),
    weightCapKg: numberFilter(vehicles.weightCapKg),
    createdAt: instantFilter(vehicles.createdAt),
  },
  sorts: {
    code: vehicles.code,
    weightCapKg: vehicles.weightCapKg,
    createdAt: vehicles.createdAt,
  },
  search: (q) =>
    or(
      ilike(vehicles.code, contains(q)),
      ilike(vehicles.registrationNo, contains(q)),
    ),
  includes: { depot: { depot: { columns: { id: true, name: true } } } },
} satisfies ResourceSpec<typeof vehicles>;

const VEHICLE_FEED = {
  ...VEHICLES,
  name: 'vehicle feed',
  pagination: 'cursor',
  defaultSort: '-createdAt',
} satisfies ResourceSpec<typeof vehicles>;

class VehicleDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() version!: number;
}

class CreateVehicleDto {
  @IsString() @Length(1, 40) id!: string;
  @IsString() @Length(1, 40) code!: string;
  @IsString() depotId!: string;
  @IsNumber() @Min(1) weightCapKg!: number;
}

class UpdateVehicleDto extends PartialType(CreateVehicleDto) {}

const audits: AuditEntry[] = [];
const events: { type: string; routing: EventRouting; inTx: boolean }[] = [];

@Injectable()
class VehicleCommands extends SimpleCrudCommands<
  typeof vehicles,
  CreateVehicleDto,
  UpdateVehicleDto
> {
  protected readonly table = vehicles;
  protected readonly module = 'fleet';
  protected readonly entityType = 'vehicle';

  constructor(txHost: TransactionHost<StampedDrizzleAdapter>) {
    super(
      txHost,
      {
        record: (entry) => {
          audits.push(entry);
          return Promise.resolve();
        },
      },
      {
        add: (type, _data, routing) => {
          events.push({ type, routing, inTx: txHost.isTransactionActive() });
          return Promise.resolve();
        },
      },
    );
  }

  protected toValues(dto: CreateVehicleDto) {
    return {
      ...dto,
      registrationNo: `REG-${dto.id}`,
      type: 'TRUCK' as const,
      temp: 'AMBIENT' as const,
      volumeCapM3: 20,
      fuelType: 'diesel',
      kmPerL: 6,
      weeklyFuelQuotaL: 400,
    };
  }

  protected toChanges(dto: UpdateVehicleDto) {
    return dto;
  }

  /** Writes, then refuses: the write must roll back with the request. */
  @Transactional()
  async createThenRefuse(dto: CreateVehicleDto): Promise<never> {
    await this.create(dto);
    throw new StateConflictError('Refused after writing.');
  }

  /** What the request's transaction is stamped as, for row-level security. */
  async stamp(): Promise<{ role: string; userId: string }> {
    const res = await this.txHost.tx.execute<{ role: string; userId: string }>(
      sql`SELECT current_setting('app.role', true) AS role,
                 current_setting('app.user_id', true) AS "userId"`,
    );
    return res.rows[0];
  }
}

@Injectable()
class VehicleLinks extends LinkBuilder<VehicleRow> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(v: VehicleRow) {
    return `/api/v1/example-vehicles/${v.id}`;
  }

  protected actions(v: VehicleRow, actor: SignedInActor): LinkMap {
    return {
      depot: { href: `/api/v1/depots/${v.depotId}` },
      edit: can(actor, 'masterData:manage') && {
        href: this.self(v),
        method: 'PATCH',
        title: 'Edit vehicle',
        requires: ['If-Match'],
      },
    };
  }
}

@Controller('example-vehicles')
class ExampleVehiclesController {
  constructor(
    private readonly queries: CrudQueryService,
    private readonly commands: VehicleCommands,
    private readonly links: VehicleLinks,
  ) {}

  @Get()
  @RequirePermission('masterData:read')
  @ApiPaginated(VehicleDto, { resource: VEHICLES })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedInActor,
    @Req() req: Request,
  ) {
    const page = await this.queries.list<VehicleRow>(VEHICLES, query);
    return this.links.page(page, actor, req, {
      create: can(actor, 'masterData:manage') && {
        href: '/api/v1/example-vehicles',
        method: 'POST',
        title: 'New vehicle',
      },
    });
  }

  @Get('feed')
  @RequirePermission('masterData:read')
  async feed(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedInActor,
    @Req() req: Request,
  ) {
    const page = await this.queries.list<VehicleRow>(VEHICLE_FEED, query);
    return this.links.page(page, actor, req);
  }

  @Get('stamp')
  @RequirePermission('masterData:read')
  stamp() {
    return this.commands.stamp();
  }

  @Get(':id')
  @RequirePermission('masterData:read')
  @ApiResource(VehicleDto)
  async get(
    @Param('id') id: string,
    @Query() q: IncludeQueryDto,
    @Actor() actor: SignedInActor,
  ) {
    const row = await this.queries.get<VehicleRow>(
      VEHICLES,
      id,
      undefined,
      q.include,
    );
    return this.links.one(row, actor);
  }

  @Post()
  @RequirePermission('masterData:manage')
  @UseIdempotency()
  @ApiResource(VehicleDto, { status: 201 })
  async create(
    @Body() dto: CreateVehicleDto,
    @Actor() actor: SignedInActor,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const row = await this.commands.create(dto);
    res.location(`/api/v1/example-vehicles/${row.id}`);
    return this.links.one(row, actor);
  }

  @Post('refused')
  @HttpCode(200)
  @RequirePermission('masterData:manage')
  refused(@Body() dto: CreateVehicleDto) {
    return this.commands.createThenRefuse(dto);
  }

  @Patch(':id')
  @RequirePermission('masterData:manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
    @IfMatch() version: number,
    @Actor() actor: SignedInActor,
  ) {
    return this.links.one(await this.commands.update(id, dto, version), actor);
  }
}

// Asymmetric matchers are typed any; holding them as unknown keeps the lint rules on.
const anyString: unknown = expect.any(String);

interface Envelope<T> {
  data: T;
  meta: {
    requestId: string;
    serverTime: string;
    apiVersion: string;
    page?: Record<string, unknown>;
  };
  _links?: Record<string, { href: string }>;
}

type VehicleResource = VehicleRow & {
  _links: Record<string, { href: string; method?: string }>;
  depot?: { id: string; name: string };
};

describeWithDb('API kernel: envelope, links, paging and problems', () => {
  jest.setTimeout(60_000);

  let app: NestExpressApplication;
  let owner: { db: Database; close: () => Promise<void> };
  let admin: string;
  let dispatcher: string;
  let depot: string;
  const sfx = suffix();
  const ids = [1, 2, 3].map((n) => `VEH-${sfx}-${n}`);

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp({
      controllers: [ExampleVehiclesController],
      providers: [VehicleCommands, VehicleLinks],
    });
    owner = ownerDatabase();
    depot = (await depotFixture(owner.db, sfx)).plg;
    await owner.db.insert(vehicles).values(
      ids.map((id, i) => ({
        id,
        code: `EX-${sfx}-${i + 1}`,
        registrationNo: `REG-${id}`,
        type: 'TRUCK' as const,
        temp: i === 2 ? ('REEFER' as const) : ('AMBIENT' as const),
        weightCapKg: 1000 * (i + 1),
        volumeCapM3: 20,
        fuelType: 'diesel',
        kmPerL: 6,
        weeklyFuelQuotaL: 400,
        depotId: depot,
      })),
    );
    admin = (await signedInAs(app, owner.db, { role: 'admin' })).cookie;
    dispatcher = (
      await signedInAs(app, owner.db, { role: 'dispatcher', depotId: depot })
    ).cookie;
  });

  afterAll(async () => {
    await owner.close();
    await app.close();
  });

  it('returns the example resource in the envelope with _links', async () => {
    const clock = freezeClock(app, '2026-10-01T15:40:03+05:30');
    const res = await api()
      .get(`/api/v1/example-vehicles/${ids[0]}?include=depot`)
      .set(browser())
      .set('Cookie', admin)
      .set('x-request-id', `req-${sfx}`)
      .expect(200);

    const body = bodyOf<Envelope<VehicleResource>>(res);
    expect(body.data).toMatchObject({ id: ids[0], version: 1 });
    expect(body.data.depot).toEqual({ id: depot, name: anyString });
    expect(body.data._links).toEqual({
      self: { href: `/api/v1/example-vehicles/${ids[0]}` },
      depot: { href: `/api/v1/depots/${depot}` },
      edit: {
        href: `/api/v1/example-vehicles/${ids[0]}`,
        method: 'PATCH',
        title: 'Edit vehicle',
        requires: ['If-Match'],
      },
    });
    expect(body.meta).toEqual({
      requestId: `req-${sfx}`,
      serverTime: '2026-10-01T15:40:03+05:30',
      apiVersion: '1.0.0',
    });
    expect(res.headers.etag).toBe('W/"1"');
    expect(res.headers['x-request-id']).toBe(`req-${sfx}`);
    clock.reset();
  });

  it('leaves out an action link the actor may not take', async () => {
    const res = await api()
      .get(`/api/v1/example-vehicles/${ids[0]}`)
      .set(browser())
      .set('Cookie', dispatcher)
      .expect(200);
    expect(
      Object.keys(bodyOf<Envelope<VehicleResource>>(res).data._links),
    ).toEqual(['self', 'depot']);
  });

  it('answers 304 when If-None-Match carries the current ETag', async () => {
    await api()
      .get(`/api/v1/example-vehicles/${ids[0]}`)
      .set(browser())
      .set('Cookie', admin)
      .set('If-None-Match', 'W/"1"')
      .expect(304);
  });

  it('pages a table by offset with filters, sort and paging links', async () => {
    const res = await api()
      .get(
        `/api/v1/example-vehicles?filter[depotId]=${depot}&filter[weightCapKg][gte]=1000&sort=-weightCapKg&limit=2`,
      )
      .set(browser())
      .set('Cookie', admin)
      .expect(200);

    const body = bodyOf<Envelope<VehicleResource[]>>(res);
    expect(body.data.map((v) => v.id)).toEqual([ids[2], ids[1]]);
    expect(body.meta.page).toEqual({ limit: 2, offset: 0, total: 3 });
    const base = `/api/v1/example-vehicles?filter[depotId]=${depot}&filter[weightCapKg][gte]=1000&sort=-weightCapKg&limit=2`;
    expect(body._links).toEqual({
      self: { href: `${base}&offset=0` },
      first: { href: `${base}&offset=0` },
      next: { href: `${base}&offset=2` },
      last: { href: `${base}&offset=2` },
      create: {
        href: '/api/v1/example-vehicles',
        method: 'POST',
        title: 'New vehicle',
      },
    });

    const next = await api()
      .get(body._links!.next.href)
      .set(browser())
      .set('Cookie', admin)
      .expect(200);
    expect(
      bodyOf<Envelope<VehicleResource[]>>(next).data.map((v) => v.id),
    ).toEqual([ids[0]]);
  });

  it('filters by any of a list, an enum and a search', async () => {
    const res = await api()
      .get(
        `/api/v1/example-vehicles?filter[depotId]=${depot}&filter[temp]=AMBIENT&q=ex-${sfx}`,
      )
      .set(browser())
      .set('Cookie', admin)
      .expect(200);
    expect(
      bodyOf<Envelope<VehicleResource[]>>(res).data.map((v) => v.id),
    ).toEqual([ids[0], ids[1]]);
  });

  it('pages a feed by cursor without repeating or losing rows', async () => {
    // The three rows were inserted together, so they tie on createdAt and
    // the id breaks the tie.
    const seen: string[] = [];
    let href: string | undefined =
      `/api/v1/example-vehicles/feed?filter[depotId]=${depot}&limit=2`;
    while (href) {
      const res: Response = await api()
        .get(href)
        .set(browser())
        .set('Cookie', admin)
        .expect(200);
      const body = bodyOf<Envelope<VehicleResource[]>>(res);
      seen.push(...body.data.map((v) => v.id));
      expect(body.meta.page).toMatchObject({ limit: 2 });
      href = body._links?.next?.href;
    }
    expect(seen).toEqual([...ids].sort().reverse());
  });

  it('fails with problem+json', async () => {
    const missing = await api()
      .get(`/api/v1/example-vehicles/VEH-${sfx}-missing`)
      .set(browser())
      .set('Cookie', admin)
      .set('x-request-id', `missing-${sfx}`)
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);
    expect(bodyOf<Problem>(missing)).toEqual({
      type: 'https://compass.waypoint.lk/problems/not-found',
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'The vehicle was not found.',
      instance: `/api/v1/example-vehicles/VEH-${sfx}-missing`,
      requestId: `missing-${sfx}`,
    });

    const badFilter = await api()
      .get('/api/v1/example-vehicles?filter[colour]=red&filter[temp]=WARM')
      .set(browser())
      .set('Cookie', admin)
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);
    expect(bodyOf<Problem>(badFilter)).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [
        { field: 'filter[colour]', code: 'unknown_filter' },
        { field: 'filter[temp]', code: 'format' },
      ],
    });

    const badCursor = await api()
      .get('/api/v1/example-vehicles/feed?cursor=bm90LWEtY3Vyc29y')
      .set(browser())
      .set('Cookie', admin)
      .expect(400);
    expect(bodyOf<Problem>(badCursor).errors).toEqual([
      expect.objectContaining({ field: 'cursor', code: 'invalid' }),
    ]);

    const forbidden = await api()
      .patch(`/api/v1/example-vehicles/${ids[0]}`)
      .set(browser())
      .set('Cookie', dispatcher)
      .set('If-Match', 'W/"1"')
      .send({ code: 'NOPE' })
      .expect(403);
    expectProblem(forbidden, 'FORBIDDEN');
  });

  it('needs If-Match on a versioned write: 428 without, 412 when stale', async () => {
    const patch = () =>
      api()
        .patch(`/api/v1/example-vehicles/${ids[1]}`)
        .set(browser())
        .set('Cookie', admin);

    const missing = await patch().send({ weightCapKg: 2100 }).expect(428);
    expectProblem(missing, 'PRECONDITION_REQUIRED');

    const malformed = await patch()
      .set('If-Match', '"1"')
      .send({ weightCapKg: 2100 })
      .expect(400);
    expect(bodyOf<Problem>(malformed).errors).toEqual([
      expect.objectContaining({ field: 'If-Match', code: 'format' }),
    ]);

    const invalid = await patch()
      .set('If-Match', 'W/"1"')
      .send({ weightCapKg: -5, colour: 'red' })
      .expect(400);
    expect(bodyOf<Problem>(invalid).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'weightCapKg', code: 'min' }),
        expect.objectContaining({ field: 'colour', code: 'not_allowed' }),
      ]),
    );

    const ok = await patch()
      .set('If-Match', 'W/"1"')
      .send({ weightCapKg: 2100 })
      .expect(200);
    expect(ok.headers.etag).toBe('W/"2"');
    expect(bodyOf<Envelope<VehicleResource>>(ok).data.weightCapKg).toBe(2100);

    const stale = await patch()
      .set('If-Match', 'W/"1"')
      .send({ weightCapKg: 2200 })
      .expect(412);
    expectProblem(stale, 'VERSION_MISMATCH');

    expect(audits.filter((a) => a.entity[1] === ids[1])).toEqual([
      expect.objectContaining({ action: 'fleet.vehicle.updated' }),
    ]);
  });

  it('replays a repeated Idempotency-Key instead of creating twice', async () => {
    const id = `VEH-${sfx}-new`;
    const body = {
      id,
      code: `EX-${sfx}-new`,
      depotId: depot,
      weightCapKg: 900,
    };
    const create = (key: string, payload: object) =>
      api()
        .post('/api/v1/example-vehicles')
        .set(browser())
        .set('Cookie', admin)
        .set('Idempotency-Key', key)
        .send(payload);

    const first = await create(`key-${sfx}`, body).expect(201);
    expect(first.headers.location).toBe(`/api/v1/example-vehicles/${id}`);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const again = await create(`key-${sfx}`, body).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.headers.location).toBe(`/api/v1/example-vehicles/${id}`);
    expect(bodyOf<Envelope<VehicleResource>>(again).data).toEqual(
      bodyOf<Envelope<VehicleResource>>(first).data,
    );

    const reused = await create(`key-${sfx}`, {
      ...body,
      weightCapKg: 950,
    }).expect(422);
    expectProblem(reused, 'IDEMPOTENCY_KEY_REUSED');

    const rows = await owner.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, id));
    expect(rows).toHaveLength(1);
    expect(events.filter((e) => e.routing.aggregate[1] === id)).toEqual([
      {
        type: 'vehicle.created',
        routing: { aggregate: ['vehicle', id] },
        inTx: true,
      },
    ]);
  });

  it('rolls the whole request back when it fails after writing', async () => {
    const id = `VEH-${sfx}-refused`;
    const res = await api()
      .post('/api/v1/example-vehicles/refused')
      .set(browser())
      .set('Cookie', admin)
      .send({ id, code: `EX-${sfx}-refused`, depotId: depot, weightCapKg: 900 })
      .expect(409);
    expectProblem(res, 'CONFLICT_STATE');
    const rows = await owner.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(inArray(vehicles.id, [id]));
    expect(rows).toEqual([]);
  });

  it('documents the contract in OpenAPI: envelope, filters, headers and problems', () => {
    const doc = buildOpenApiDocument(app);
    const list = doc.paths['/api/v1/example-vehicles'].get!;
    const create = doc.paths['/api/v1/example-vehicles'].post!;
    const update = doc.paths['/api/v1/example-vehicles/{id}'].patch!;
    const params = (op: typeof list) =>
      (op.parameters ?? []).map((p) =>
        'name' in p ? `${p.in}:${p.name}${p.required ? '!' : ''}` : '$ref',
      );

    expect(list.operationId).toBe('exampleVehiclesList');
    expect(params(list)).toEqual(
      expect.arrayContaining([
        'query:filter[depotId]',
        'query:limit',
        'query:sort',
      ]),
    );
    expect(Object.keys(list.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403']),
    );
    expect(params(create)).toContain('header:Idempotency-Key');
    expect(params(update)).toContain('header:If-Match!');
    expect(update.responses['412']).toMatchObject({
      content: {
        'application/problem+json': {
          schema: { $ref: '#/components/schemas/ProblemDto' },
        },
      },
    });
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['ProblemDto', 'LinkDto', 'OffsetPageMetaDto']),
    );
  });

  it('stamps the request transaction with the actor for row-level security', async () => {
    const res = await api()
      .get('/api/v1/example-vehicles/stamp')
      .set(browser())
      .set('Cookie', dispatcher)
      .expect(200);
    expect(bodyOf<Envelope<{ role: string }>>(res).data.role).toBe(
      'dispatcher',
    );
  });
});
