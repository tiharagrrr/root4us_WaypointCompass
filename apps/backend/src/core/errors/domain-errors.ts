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

export class StateConflictError extends DomainError {
  readonly code = 'CONFLICT_STATE';
  readonly status = 409;
  readonly title = 'This conflicts with the current state';
}
