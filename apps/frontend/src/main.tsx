import { configureApi } from '@compass/api-client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/app'
import './index.css'
import './i18n'

configureApi({ baseUrl: import.meta.env.VITE_API_BASE ?? '' })

/** In development MSW serves every endpoint not in src/mocks/live.ts. VITE_MSW=off turns it off. */
const enableMocking = async (): Promise<void> => {
  if (!import.meta.env.DEV || import.meta.env.VITE_MSW === 'off') return
  const { startMocking } = await import('./mocks/browser')
  await startMocking()
}

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

void enableMocking().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
