import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

/** Starts the Mock Service Worker (public/mockServiceWorker.js). Development only; see main.tsx. */
export const startMocking = async (): Promise<void> => {
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
  console.info('[msw] mocking every /api/v1 endpoint not listed in src/mocks/live.ts')
}
