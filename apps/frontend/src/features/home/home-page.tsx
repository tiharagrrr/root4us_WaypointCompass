import { Link } from 'react-router'
import { ROLE_ROUTES } from '@/app/role-routes'
import { Card } from '@/ui/card'
import { StatusChip } from '@/ui/status-chip'
import { Wordmark } from '@/ui/wordmark'
import { useHealth } from './health'

/** Start page in development: API health and a way into each role's shell. */
export function HomePage() {
  const health = useHealth()
  const ok = health.data?.status === 'ok'

  return (
    <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <Wordmark />
        <p className="type-body m-0 text-slate-700">Delivery planning for Waypoint Fresh, Style and Tech.</p>
        <div role="status">
          <StatusChip tone={health.isPending ? 'muted' : ok ? 'success' : 'danger'}>
            {health.isPending ? 'Checking API…' : ok ? 'API, database and Redis online' : 'API unavailable'}
          </StatusChip>
        </div>
      </header>

      <nav aria-label="Roles">
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 p-0">
          {ROLE_ROUTES.map((r) => (
            <li key={r.path}>
              <Card asChild>
                <Link to={r.path} className="flex min-h-11 flex-col gap-1.5 p-4 no-underline transition-colors hover:border-primary focus-visible:border-primary">
                  <strong className="type-card-title text-foreground">{r.label}</strong>
                  <span className="type-body text-muted-foreground">{r.summary}</span>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  )
}
