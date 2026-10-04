// Figma: L1 Sign in · 185:19312 (tablet) and L1m Sign in · 254:1243 (phone)
import { getDeviceId, getMeGetQueryOptions } from '@compass/api-client'
import { DEPOTS, DEPOT_NAMES, type Depot } from '@waypoint/shared/domain'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { queryClient } from '@/app/query-client'
import { Button } from '@/ui/button'
import { PinKeypad } from '@/ui/pin-keypad'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Wordmark } from '@/ui/wordmark'
import { authClient } from './auth-client'

/** What L1 says for each refusal POST /api/auth/sign-in/pin gives. */
const REFUSALS: Record<string, string> = {
  NOT_A_DOCK_DEVICE:
    'This tablet is not registered as a dock device for that depot. Ask your admin to add it. To register it, sign in here once with an email and password; the admin then marks it under Settings › Dock tablets.',
  WRONG_PIN: 'That PIN is not one of this depot’s loaders. Try again.',
}

const PIN_LENGTH = 4

/**
 * L1. The dock tablet is shared and bolted to a wall, so there is no email and no password: a
 * depot and four digits, and whichever loader of that depot the PIN belongs to gets the session.
 *
 * The depot list is the fixed master data in @waypoint/shared, not a request: this screen runs
 * before there is a session to make one with.
 */
export function DockSignInPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [depot, setDepot] = useState<Depot>(DEPOTS[0])
  const [pin, setPin] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const signIn = async (typed: string) => {
    if (typed.length !== PIN_LENGTH || busy) return
    setBusy(true)
    setRefusal(null)
    const result = await authClient.$fetch('/sign-in/pin', {
      method: 'POST',
      body: { depotId: depot, pin: typed, deviceId: getDeviceId() },
    })
    setBusy(false)
    if (result.error) {
      // BetterAuth's typed error carries status and message; our plugin's `code` rides along with
      // the body, so it is read as unknown rather than asserted.
      const code = (result.error as { code?: unknown }).code
      setRefusal((typeof code === 'string' ? REFUSALS[code] : undefined) ?? result.error.message ?? t('dockSignIn.failed'))
      setPin('')
      setAttempt((n) => n + 1)
      return
    }
    queryClient.clear()
    await queryClient.fetchQuery(getMeGetQueryOptions())
    void navigate('/dock', { replace: true })
  }

  return (
    <main className="flex min-h-svh flex-col bg-background sm:items-center sm:justify-center sm:bg-page sm:px-4" data-density="touch">
      {/* L1m's app bar: a phone has no room for the tablet's centred lockup over a card. */}
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-5 sm:hidden">
        <Wordmark />
        <span className="type-label uppercase text-muted-foreground">{t('dockSignIn.loader')}</span>
      </header>
      <div className="flex w-full flex-1 flex-col gap-5 sm:w-[420px] sm:max-w-full sm:flex-none">
        <div className="hidden h-7 items-start justify-center sm:flex">
          <Wordmark size="lg" />
        </div>
        <div className="flex flex-1 flex-col sm:flex-none sm:rounded-lg sm:border sm:border-border sm:bg-background sm:shadow-sm">
          <div className="flex flex-1 flex-col gap-5 px-5 pb-6 pt-8 sm:flex-none sm:gap-[18px] sm:p-6">
            <div className="flex flex-col gap-1">
              <h1 className="m-0 font-sans text-[30px] font-bold tracking-[-0.6px] text-foreground sm:text-[22px] sm:tracking-normal">
                {t('dockSignIn.title')}
              </h1>
              <p className="type-body-medium m-0 text-muted-foreground">{t('dockSignIn.subtitle')}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="type-label m-0 uppercase text-muted-foreground" id="dock-depot-label">
                {t('dockSignIn.depot')}
              </p>
              <Select value={depot} onValueChange={(next) => setDepot(next as Depot)}>
                <SelectTrigger aria-labelledby="dock-depot-label" className="h-[52px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPOTS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {DEPOT_NAMES[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="type-caption m-0 text-muted-foreground">{t('dockSignIn.depotHint')}</p>
            </div>

            <PinKeypad
              length={PIN_LENGTH}
              resetKey={attempt}
              disabled={busy}
              onChange={setPin}
              onComplete={(typed) => void signIn(typed)}
              label={t('dockSignIn.keypad')}
            />

            {refusal ? (
              <p role="alert" className="type-body m-0 rounded-md border border-status-danger-border bg-status-danger-bg px-3 py-2 text-destructive-foreground">
                {refusal}
              </p>
            ) : null}

            {/* On a phone the keypad sits under the thumb and Sign in holds the bottom edge. */}
            <div className="flex-1 sm:hidden" />

            <Button
              variant="primary"
              className="h-[52px] w-full text-[16px]"
              disabled={pin.length !== PIN_LENGTH}
              loading={busy}
              onClick={() => void signIn(pin)}
            >
              {t('dockSignIn.submit')}
            </Button>
            <Link to="/sign-in" className="type-body self-center font-medium text-primary">
              {t('dockSignIn.emailInstead')}
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
