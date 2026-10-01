/** One field-level error in a problem's errors[] (VALIDATION_FAILED). */
export interface FieldError {
  /** Path in the request body, e.g. "lines[2].qty". */
  field: string;
  code: string;
  message: string;
}

/** An RFC 9457 problem+json body as the Compass API sends it (specs/api-conventions.md, section 3). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  /** Stable machine code: VALIDATION_FAILED, CUTOFF_PASSED, ... */
  code: string;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: FieldError[];
  violations?: Record<string, unknown>[];
  _links?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFieldError = (value: unknown): value is FieldError =>
  isRecord(value) &&
  typeof value.field === 'string' &&
  typeof value.code === 'string' &&
  typeof value.message === 'string';

/** The code to use when a failed response carries no problem body (a proxy error page, say). */
export const codeForStatus = (status: number): string => {
  if (status === 400) return 'VALIDATION_FAILED';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT_STATE';
  if (status === 412) return 'VERSION_MISMATCH';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 428) return 'PRECONDITION_REQUIRED';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'DEPENDENCY_UNAVAILABLE';
  return status >= 500 ? 'INTERNAL' : `HTTP_${status}`;
};

/**
 * Thrown by compassFetch for every non-2xx response. Screens read code, status, title, detail and
 * errors[]; forms pass it to applyProblem().
 */
export class ApiProblem extends Error {
  readonly problem: Problem;
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly errors: FieldError[];
  readonly requestId: string | undefined;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiProblem';
    this.problem = problem;
    this.status = problem.status;
    this.code = problem.code;
    this.title = problem.title;
    this.detail = problem.detail;
    this.errors = problem.errors ?? [];
    this.requestId = problem.requestId;
  }

  /** Builds the problem from a parsed response body, falling back to the status when it is not one. */
  static from(status: number, statusText: string, body: unknown): ApiProblem {
    const source = isRecord(body) ? body : {};
    const str = (key: string): string | undefined =>
      typeof source[key] === 'string' ? (source[key] as string) : undefined;
    const problem: Problem = {
      type: str('type') ?? 'about:blank',
      title: str('title') ?? (statusText || `Request failed with status ${status}`),
      status: typeof source.status === 'number' ? source.status : status,
      code: str('code') ?? codeForStatus(status),
      detail: str('detail'),
      instance: str('instance'),
      requestId: str('requestId'),
      errors: Array.isArray(source.errors) ? source.errors.filter(isFieldError) : undefined,
      violations: Array.isArray(source.violations) ? source.violations.filter(isRecord) : undefined,
      _links: isRecord(source._links) ? source._links : undefined,
    };
    return new ApiProblem(problem);
  }
}

export const isApiProblem = (error: unknown): error is ApiProblem => error instanceof ApiProblem;
