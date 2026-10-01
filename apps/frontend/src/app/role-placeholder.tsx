import { Link } from 'react-router'
import type { RoleRoute } from './role-routes'

export function RolePlaceholder({ route }: { route: RoleRoute }) {
  return (
    <main className="mx-auto flex max-w-[960px] flex-col gap-3 px-4 py-6">
      <p className="m-0">
        <Link to="/" className="type-body text-primary">
          ← All roles
        </Link>
      </p>
      <h1 className="type-page-title m-0">{route.label}</h1>
      <p className="type-body m-0 text-slate-700">{route.summary}</p>
      <p className="type-body m-0 text-muted-foreground">Screens from the Designathon submission go here.</p>
    </main>
  )
}
