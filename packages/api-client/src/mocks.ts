/**
 * MSW handlers generated from the OpenAPI examples, one group per tag. Development and tests only:
 * import from '@compass/api-client/mocks', never from app code that ships.
 */
import type { RequestHandler } from 'msw';
import * as generated from './gen/endpoints/index.msw.ts';

export * from './gen/endpoints/index.msw.ts';

/** Every generated handler, in tag order. */
export const getAllMockHandlers = (): RequestHandler[] =>
  Object.values(generated).flatMap((getTagMock) => getTagMock());
