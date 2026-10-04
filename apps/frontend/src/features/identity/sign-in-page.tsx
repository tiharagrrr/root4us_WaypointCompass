// Figma: A0 Sign in · 185:8713
import { getMeGetQueryOptions, useMeGet, type UserRole } from '@compass/api-client'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { queryClient } from '@/app/query-client'
import { Button } from '@/ui/button'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { Wordmark } from '@/ui/wordmark'
import { authClient } from './auth-client'
import { ROLE_HOME } from './role-home'

interface SignInForm {
  identifier: string
  password: string
}

/** What A0 says for each refusal BetterAuth gives (wrong password, wrong origin, rate limited). */
const REFUSALS: Record<number, string> = {
  401: 'That email or password is wrong. Check both and try again.',
  403: 'Sign-in was refused from this address. Open the app at the address your admin gave you (APP_URL), or add this one to TRUSTED_ORIGINS.',
  429: 'Too many tries. Wait a minute, then sign in again.',
}

const looksLikePhone = (value: string) => /^\+?\d[\d\s]{6,}$/.test(value.trim())

/**
 * Sign in with email or username and password (admins, dispatchers, store managers). Drivers sign
 * in with a phone code (D0a) and loaders with a dock PIN (L1), so a phone number typed here goes
 * to the driver flow with the number filled in, and the foot of the card points at both.
 */
export function SignInPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [refusal, setRefusal] = useState<string | null>(null)
  const form = useForm<SignInForm>({ defaultValues: { identifier: '', password: '' } })
  const { errors, isSubmitting } = form.formState
  // Already signed in: straight to the role's home (or where they were going), not the form again.
  const me = useMeGet({ query: { retry: false } })

  const next = params.get('next')
  const destination = (role: UserRole) => (next?.startsWith('/') ? next : ROLE_HOME[role])

  const onSubmit = form.handleSubmit(async ({ identifier, password }) => {
    setRefusal(null)
    const id = identifier.trim()
    if (looksLikePhone(id)) {
      void navigate(`/sign-in/driver?phone=${encodeURIComponent(id)}`)
      return
    }
    const result = id.includes('@')
      ? await authClient.signIn.email({ email: id, password })
      : await authClient.signIn.username({ username: id, password })
    if (result.error) {
      setRefusal(REFUSALS[result.error.status] ?? (result.error.message || 'Sign-in failed. Try again.'))
      return
    }
    queryClient.clear()
    const signedIn = await queryClient.fetchQuery(getMeGetQueryOptions())
    void navigate(destination(signedIn.data.role as UserRole), { replace: true })
  })

  if (me.data) return <Navigate to={destination(me.data.data.role)} replace />

  return (
    <main className="flex min-h-svh items-center justify-center bg-page px-4">
      <div className="flex w-[400px] flex-col gap-6">
        <div className="flex h-8 items-start justify-center">
          <Wordmark size="lg" />
        </div>
        <div className="rounded-lg border border-border bg-background p-px shadow-sm">
          <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-[18px] p-7">
            <div className="flex flex-col gap-1">
              <h1 className="m-0 font-sans text-[22px] font-bold leading-auto text-foreground">Sign in</h1>
              <p className="m-0 font-sans text-[14px] leading-[20.3px] text-muted-foreground">Use the account your admin invited you to.</p>
            </div>
            <Field label="Email or username" error={errors.identifier?.message}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('identifier', { required: 'Enter your email or username' })}
                  autoComplete="username"
                  autoFocus
                  className="h-11 text-[15px]"
                />
              )}
            </Field>
            <Field label="Password" error={errors.password?.message}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('password', { required: 'Enter your password' })}
                  type="password"
                  autoComplete="current-password"
                  className="h-11 text-[15px]"
                />
              )}
            </Field>
            <div className="flex h-[17px] justify-end">
              <span className="font-sans text-[13px] font-medium text-primary" title="Password reset is not built yet: ask your admin">
                Forgot password? Ask your admin.
              </span>
            </div>
            {refusal ? (
              <p role="alert" className="type-body m-0 rounded-md border border-status-danger-border bg-status-danger-bg px-3 py-2 text-destructive-foreground">
                {refusal}
              </p>
            ) : null}
            <Button type="submit" variant="primary" size="lg" loading={isSubmitting} className="h-11 w-full text-[15px]">
              Sign in
            </Button>
          </form>
        </div>
        <p className="type-body m-0 text-center text-muted-foreground">
          Your role, and the outlet, depot or vehicle you see, are set by your admin.
        </p>
        <nav aria-label="Other ways to sign in" className="flex flex-col items-center gap-1.5">
          <Link to="/sign-in/driver" className="type-body font-medium text-primary">
            Driver? Sign in with a code sent to your phone
          </Link>
          <Link to="/sign-in/dock" className="type-body font-medium text-primary">
            Loader at the dock? Use the PIN keypad
          </Link>
        </nav>
      </div>
    </main>
  )
}
