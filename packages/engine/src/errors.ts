export const ENGINE_INPUT_ERROR_CODES = [
  'INVALID_DATE',
  'UNKNOWN_ORDER',
  'UNKNOWN_VEHICLE',
  'UNKNOWN_DISTRICT',
  'UNKNOWN_OUTLET',
  'MISSING_ALLOWANCE',
] as const;
export type EngineInputErrorCode = (typeof ENGINE_INPUT_ERROR_CODES)[number];

export interface EngineInputErrorInit {
  code: EngineInputErrorCode;
  /** Where in the input the problem is, for example "plan.trips[1].orderIds[0]". */
  field: string;
  /** The offending value as given. */
  value: string;
  /** What is wrong with it, as a phrase that follows the value: "is not in input.orders". */
  reason: string;
  /** The lower-level error that caused this one, when there is one. */
  cause?: unknown;
}

/**
 * The input broke a precondition the engine cannot plan around. It says which field, which value and
 * why, so a caller (the API, the web editor, a test) can point at the exact problem without parsing
 * a message. A rule violation is not an input error: violations are returned, never thrown.
 */
export class EngineInputError extends Error {
  readonly code: EngineInputErrorCode;
  readonly field: string;
  readonly value: string;

  constructor({ code, field, value, reason, cause }: EngineInputErrorInit) {
    super(`${field} ${JSON.stringify(value)} ${reason} [${code}]`, cause === undefined ? undefined : { cause });
    this.name = 'EngineInputError';
    this.code = code;
    this.field = field;
    this.value = value;
  }
}
