import { getAllMockHandlers } from '@compass/api-client/mocks'
import type { RequestHandler } from 'msw'
import { liveHandlers } from './live'

/** Live endpoints first (pass through to the API), then a generated mock for everything else. */
export const handlers: RequestHandler[] = [...liveHandlers(), ...getAllMockHandlers()]
