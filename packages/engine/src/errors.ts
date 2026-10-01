/** The input broke a precondition the engine cannot plan around, such as a missing allowance. */
export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInputError';
  }
}
