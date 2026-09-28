import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchHealth } from '../lib/api'
import { ROLE_ROUTES } from './roles'

export function Home() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
  })

  const ok = health.data?.status === 'ok'

  return (
    <main className="shell">
      <header>
        <h1>Waypoint</h1>
        <p>Delivery planning for Waypoint Fresh, Style and Tech.</p>
        <p className={`badge ${ok ? 'badge-ok' : 'badge-down'}`} role="status">
          {health.isPending ? 'Checking API…' : ok ? 'API, database and Redis online' : 'API unavailable'}
        </p>
      </header>

      <nav aria-label="Roles">
        <ul className="roles">
          {ROLE_ROUTES.map((r) => (
            <li key={r.path}>
              <Link to={r.path}>
                <strong>{r.label}</strong>
                <span>{r.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  )
}
