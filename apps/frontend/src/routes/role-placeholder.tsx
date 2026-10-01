import { Link } from 'react-router'
import type { RoleRoute } from './role-routes'

export function RolePlaceholder({ route }: { route: RoleRoute }) {
  return (
    <main className="shell">
      <p>
        <Link to="/">← All roles</Link>
      </p>
      <h1>{route.label}</h1>
      <p>{route.summary}</p>
      <p className="muted">Screens from the Designathon submission go here.</p>
    </main>
  )
}
