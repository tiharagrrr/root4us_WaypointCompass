import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  type Type,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiQuery,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Actor as SignedInActor, Permission } from '@waypoint/shared';
import type { Request } from 'express';
import {
  PreconditionRequiredError,
  UnauthenticatedError,
  ValidationError,
} from '../errors/domain-errors';
import type { ResourceSpec } from '../persistence/resource-spec';
import {
  CursorPageMetaDto,
  LinkDto,
  MetaDto,
  OffsetPageMetaDto,
  ProblemDto,
} from './api.dto';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/** Public route: no session needed. BetterAuth's AuthGuard and PermissionGuard skip it. */
export { AllowAnonymous } from '@thallesp/nestjs-better-auth';

/** Metadata key @AllowAnonymous() sets (from @thallesp/nestjs-better-auth). */
export const PUBLIC_KEY = 'PUBLIC';
export const PERMISSION_KEY = 'waypoint:permission';
export const ANY_ROLE = 'any';

/** What a route declares: a permission, or any signed-in role. */
export type RouteAccess = Permission | typeof ANY_ROLE;

/**
 * The route needs this permission; PermissionGuard answers 403 FORBIDDEN
 * without it. Every route declares exactly one of @RequirePermission,
 * @AnyRole or @AllowAnonymous; a route with none is refused.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

/** Any signed-in role may call the route; its queries still apply the actor's scope. */
export const AnyRole = () => SetMetadata(PERMISSION_KEY, ANY_ROLE);

/** The signed-in actor, built by ActorGuard. */
export type Actor = SignedInActor;
export const Actor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SignedInActor => {
    const actor = ctx
      .switchToHttp()
      .getRequest<{ actor?: SignedInActor }>().actor;
    if (!actor) throw new UnauthenticatedError();
    return actor;
  },
);

const PROBLEM_DESCRIPTIONS: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND (also outside your scope)',
  409: 'CONFLICT_STATE, CUTOFF_PASSED or PLAN_LOCKED',
  412: 'VERSION_MISMATCH',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'PLAN_RULE_VIOLATION or IDEMPOTENCY_KEY_REUSED',
  428: 'PRECONDITION_REQUIRED',
  429: 'RATE_LIMITED',
};

/** problem+json responses with these statuses, all shaped as ProblemDto. */
export const ApiProblems = (...statuses: number[]) =>
  applyDecorators(
    ApiExtraModels(ProblemDto),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: PROBLEM_DESCRIPTIONS[status] ?? 'Problem',
        content: {
          'application/problem+json': {
            schema: { $ref: getSchemaPath(ProblemDto) },
          },
        },
      }),
    ),
  );

/** Applies a method decorator from a parameter decorator (for OpenAPI metadata). */
const onMethod =
  (decorator: MethodDecorator): ParameterDecorator =>
  (target, key) => {
    if (key === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor) decorator(target, key, descriptor);
  };

/**
 * The version from `If-Match: W/"<version>"` on a versioned write: 428
 * PRECONDITION_REQUIRED when missing, 400 when malformed. The service's
 * update filters on it and throws VersionMismatchError (412) when stale.
 */
export const IfMatch = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): number => {
    const raw = ctx.switchToHttp().getRequest<Request>().header('if-match');
    if (!raw) throw new PreconditionRequiredError();
    const match = /^W\/"(\d{1,9})"$/.exec(raw.trim());
    if (!match)
      throw new ValidationError([
        {
          field: 'If-Match',
          code: 'format',
          message: 'Expected W/"<version>", as sent in the ETag header.',
        },
      ]);
    return Number(match[1]);
  },
  [
    onMethod(
      ApiHeader({
        name: 'If-Match',
        required: true,
        description: 'W/"<version>" from the ETag of the resource you loaded',
      }),
    ),
    onMethod(ApiProblems(412, 428)),
  ],
);

/**
 * Creates and non-repeatable actions: a repeated Idempotency-Key replays the
 * first response instead of acting twice (IdempotencyInterceptor).
 */
export const UseIdempotency = () =>
  applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description: 'One per button press; a repeat replays the first response',
    }),
    ApiProblems(409, 422),
  );

/** One resource in the envelope: { data: model, meta }. */
export const ApiResource = <T extends Type<unknown>>(
  model: T,
  opts: { status?: 200 | 201 | 202 } = {},
) =>
  applyDecorators(
    ApiExtraModels(model, MetaDto, LinkDto),
    ApiResponse({
      status: opts.status ?? 200,
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: getSchemaPath(model) },
          meta: { $ref: getSchemaPath(MetaDto) },
        },
      },
    }),
    ApiProblems(400, 401, 403, 404),
  );

/**
 * A page of resources: { data: model[], meta (with page), _links }, plus the
 * resource's filters as filter[field] query parameters.
 */
export const ApiPaginated = <T extends Type<unknown>>(
  model: T,
  opts: { resource?: ResourceSpec } = {},
) => {
  const pageMeta =
    opts.resource?.pagination === 'cursor'
      ? CursorPageMetaDto
      : OffsetPageMetaDto;
  return applyDecorators(
    ApiExtraModels(model, pageMeta, LinkDto),
    ...Object.entries(opts.resource?.filters ?? {}).map(([field, filter]) =>
      ApiQuery({
        name: `filter[${field}]`,
        required: false,
        type: String,
        description: `${filter.format}; comma-separated for any of. Also filter[${field}][op] with op in ${filter.ops.join(', ')}.`,
      }),
    ),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta', '_links'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(pageMeta) },
          _links: {
            type: 'object',
            additionalProperties: { $ref: getSchemaPath(LinkDto) },
          },
        },
      },
    }),
    ApiProblems(400, 401, 403),
  );
};

/**
 * A resource's `_links`: relation to LinkDto, so generated clients type each
 * link instead of seeing an untyped object.
 */
export const ApiLinks = () =>
  ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(LinkDto) },
  });
