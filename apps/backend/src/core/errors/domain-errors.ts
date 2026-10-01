/**
 * Every refusal the API gives is a DomainError subclass with a stable code.
 * ProblemDetailsFilter renders it as application/problem+json; never build
 * problem JSON by hand or catch a domain error in a controller.
 * Codes and statuses: specs/api-conventions.md, section 3.
 */
export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
  abstract readonly title: string;

  constructor(readonly detail?: string) {
    super(detail);
    this.name = new.target.name;
  }

  /** Extra problem members, such as `errors` for a validation failure. */
  extensions(): Record<string, unknown> {
    return {};
  }

  /** Response headers that go with the problem, such as Retry-After. */
  headers(): Record<string, string> {
    return {};
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 400;
  readonly title = 'Some fields need attention';

  constructor(readonly errors: FieldError[]) {
    super();
  }

  extensions() {
    return { errors: this.errors };
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  readonly status = 401;
  readonly title = 'Sign in to continue';
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly status = 403;
  readonly title = "You don't have access to this";
}

/** Also thrown for rows outside the actor's scope, with the same body. */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;
  readonly title = 'Not found';

  constructor(resource: string) {
    // No id in the detail: an out-of-scope row must look like a missing one.
    super(`The ${resource} was not found.`);
  }
}

/** A state machine refusal (shared assertTransition() maps here too) or a duplicate. */
export class StateConflictError extends DomainError {
  readonly code = 'CONFLICT_STATE';
  readonly status = 409;
  readonly title = 'This conflicts with the current state';
}

export class CutoffPassedError extends DomainError {
  readonly code = 'CUTOFF_PASSED';
  readonly status = 409;
  readonly title = 'The cutoff has passed';
}

export class PlanLockedError extends DomainError {
  readonly code = 'PLAN_LOCKED';
  readonly status = 409;
  readonly title = 'The plan is locked';
}

/** A versioned update matched no row: someone changed it first. */
export class VersionMismatchError extends DomainError {
  readonly code = 'VERSION_MISMATCH';
  readonly status = 412;
  readonly title = 'Someone else changed this';

  constructor(resource: string) {
    super(`The ${resource} changed since you loaded it. Reload and try again.`);
  }
}

/** A versioned write came without If-Match (thrown by @IfMatch()). */
export class PreconditionRequiredError extends DomainError {
  readonly code = 'PRECONDITION_REQUIRED';
  readonly status = 428;
  readonly title = 'If-Match is required';

  constructor() {
    super('Send If-Match: W/"<version>" with the version you loaded.');
  }
}

/** One broken planning rule, as the engine's validator reports it. */
export interface RuleViolation {
  rule: string;
  severity: 'HARD' | 'SOFT';
  message: string;
  [detail: string]: unknown;
}

export class RuleViolationError extends DomainError {
  readonly code = 'PLAN_RULE_VIOLATION';
  readonly status = 422;
  readonly title = 'The change breaks a planning rule';

  constructor(
    readonly violations: RuleViolation[],
    detail?: string,
    readonly links?: Record<string, unknown>,
  ) {
    super(detail);
  }

  extensions() {
    return {
      violations: this.violations,
      ...(this.links && { _links: this.links }),
    };
  }
}

/** The same Idempotency-Key came back with a different request. */
export class IdempotencyKeyReusedError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  readonly status = 422;
  readonly title = 'This Idempotency-Key was used for another request';
}

/** The first request with this Idempotency-Key is still running. */
export class IdempotencyInFlightError extends StateConflictError {
  constructor() {
    super('The same request is still being processed.');
  }

  headers() {
    return { 'Retry-After': '1' };
  }
}

export class PayloadTooLargeError extends DomainError {
  readonly code = 'PAYLOAD_TOO_LARGE';
  readonly status = 413;
  readonly title = 'The request is too large';
}

export class RateLimitedError extends DomainError {
  readonly code = 'RATE_LIMITED';
  readonly status = 429;
  readonly title = 'Too many requests';

  constructor(readonly retryAfterSeconds: number) {
    super();
  }

  headers() {
    return { 'Retry-After': String(this.retryAfterSeconds) };
  }
}

/** Redis, storage or a provider is down. */
export class DependencyUnavailableError extends DomainError {
  readonly code = 'DEPENDENCY_UNAVAILABLE';
  readonly status = 503;
  readonly title = 'A service we depend on is unavailable';

  constructor(
    detail?: string,
    readonly retryAfterSeconds = 30,
  ) {
    super(detail);
  }

  headers() {
    return { 'Retry-After': String(this.retryAfterSeconds) };
  }
}
