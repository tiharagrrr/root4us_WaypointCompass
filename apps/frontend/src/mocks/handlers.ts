import { getAllMockHandlers } from '@compass/api-client/mocks'
import type { RequestHandler } from 'msw'
import { liveHandlers } from './live'
import { exposeDemoControls, orderingDemoHandlers } from './ordering-demo'

exposeDemoControls()

/**
 * Live endpoints first (pass through to the API), then the hand-built Ordering demo for the store
 * screens, then a generated mock for everything else. Adding a path to live.ts is all it takes to
 * move an endpoint to the real API: the pass-through wins over both mock layers.
 */
export const handlers: RequestHandler[] = [...liveHandlers(), ...orderingDemoHandlers(), ...getAllMockHandlers()]
