import { useMeGet } from '@compass/api-client'
import { Link, Navigate } from 'react-router'
import { ROLE_ROUTES } from '@/app/role-routes'
import { ROLE_HOME } from '@/features/identity/role-home'
import { Button } from '@/ui/button'
import { Card } from '@/ui/card'
import { Wordmark } from '@/ui/wordmark'

/** The three ways in, one per kind of device (A0, D0a, L1). */
const SIGN_INS = [
  { to: '/sign-in', label: 'Email and password', primary: true },
  { to: '/sign-in/driver', label: 'Driver · code by SMS', primary: false },
  { to: '/sign-in/dock', label: 'Loader · dock PIN', primary: false },
]

/**
 * Start page: the three ways to sign in and a way into each role's area. Someone who is already
 * signed in goes straight to their role's home.
 */
export function HomePage() {
  const me = useMeGet({ query: { retry: false } })

  if (me.data) return <Navigate to={ROLE_HOME[me.data.data.role]} replace />

  return (
    <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <Wordmark />
        <p className="type-body m-0 text-slate-700">Delivery planning for Waypoint Fresh, Style and Tech.</p>
      </header>

      <section aria-labelledby="sign-in-heading" className="flex flex-col gap-3">
        <h2 id="sign-in-heading" className="type-title m-0 text-foreground">
          Sign in
        </h2>
        <div className="flex flex-wrap gap-2">
          {SIGN_INS.map((way) => (
            <Button key={way.to} asChild variant={way.primary ? 'primary' : 'outline'}>
              <Link to={way.to}>{way.label}</Link>
            </Button>
          ))}
        </div>
        <p className="type-body m-0 text-muted-foreground">
          Admins, dispatchers and store managers use an email or username and a password. Drivers get a code by SMS. Loaders enter their
          PIN on the depot’s dock tablet.
        </p>
      </section>

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
