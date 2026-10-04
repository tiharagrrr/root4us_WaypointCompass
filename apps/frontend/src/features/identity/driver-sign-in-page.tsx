// Figma: D0a Sign in · 244:828 and D0b Enter code · 244:937 (phone 390 × 844)
import { getMeGetQueryOptions } from '@compass/api-client'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { queryClient } from '@/app/query-client'
import { Button } from '@/ui/button'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { Wordmark } from '@/ui/wordmark'
import { authClient } from './auth-client'
import { toPhone } from './contact'

/** D0b: "Resend after 60 seconds" (specs/identity/spec.md, Screens). */
const RESEND_AFTER_S = 60
const CODE_LENGTH = 6
/** +94 and nine digits: what toPhone makes of "077 604 1932". */
const SRI_LANKAN_MOBILE = /^\+94\d{9}$/

interface PhoneForm {
  phone: string
}
interface CodeForm {
  code: string
}

/**
 * The driver's way in: her phone number (D0a), then the 6-digit code the API texts her (D0b).
 * /phone-number/verify signs her in, and the session is long and sliding so the phone stays signed
 * in through a week of trips with no signal. In demo mode the SMS lands in /demo/inbox instead.
 */
export function DriverSignInPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)
  const phoneForm = useForm<PhoneForm>({ defaultValues: { phone: params.get('phone') ?? '' } })
  const codeForm = useForm<CodeForm>({ defaultValues: { code: '' } })
  // Read at the top of render, like every other form here: formState is a proxy that subscribes to
  // what is read, and a read inside the JSX does not re-render the field's error.
  const { errors: phoneErrors, isSubmitting: sendingCode } = phoneForm.formState
  const { errors: codeErrors, isSubmitting: verifying } = codeForm.formState

  // A one-second tick, not a clock: the countdown only paces the Send again button.
  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  const sendCode = async (to: string): Promise<void> => {
    setRefusal(null)
    const result = await authClient.phoneNumber.sendOtp({ phoneNumber: to })
    if (result.error) {
      setRefusal(result.error.status === 429 ? t('driverSignIn.sendLimited') : t('driverSignIn.sendFailed'))
      return
    }
    setPhoneNumber(to)
    setResendIn(RESEND_AFTER_S)
  }

  const onPhone = phoneForm.handleSubmit(async ({ phone }) => {
    const to = toPhone(phone)
    if (!SRI_LANKAN_MOBILE.test(to)) {
      phoneForm.setError('phone', { message: t('driverSignIn.phoneInvalid') })
      return
    }
    await sendCode(to)
  })

  const onCode = codeForm.handleSubmit(async ({ code }) => {
    if (!phoneNumber) return
    setRefusal(null)
    const result = await authClient.phoneNumber.verify({ phoneNumber, code: code.trim() })
    if (result.error) {
      setRefusal(result.error.status === 429 ? t('driverSignIn.codeLimited') : t('driverSignIn.codeWrong'))
      codeForm.resetField('code')
      return
    }
    queryClient.clear()
    await queryClient.fetchQuery(getMeGetQueryOptions())
    const next = params.get('next')
    void navigate(next?.startsWith('/driver') ? next : '/driver', { replace: true })
  })

  const alert = refusal ? (
    <p role="alert" className="type-body m-0 rounded-md border border-status-danger-border bg-status-danger-bg px-3 py-2 text-destructive-foreground">
      {refusal}
    </p>
  ) : null

  return (
    <main className="flex min-h-svh flex-col bg-background sm:items-center sm:justify-center sm:bg-page sm:px-4" data-density="touch">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-5 sm:hidden">
        <Wordmark />
        <span className="type-label uppercase text-muted-foreground">{t('driverSignIn.eyebrow')}</span>
      </header>
      <div className="flex w-full flex-1 flex-col gap-5 sm:w-[400px] sm:max-w-full sm:flex-none">
        <div className="hidden h-7 items-start justify-center sm:flex">
          <Wordmark size="lg" />
        </div>
        <div className="flex flex-1 flex-col sm:flex-none sm:rounded-lg sm:border sm:border-border sm:bg-background sm:shadow-sm">
          {phoneNumber === null ? (
            <form noValidate onSubmit={(e) => void onPhone(e)} className="flex flex-1 flex-col gap-5 px-5 pb-6 pt-8 sm:flex-none sm:gap-[18px] sm:p-6">
              <div className="flex flex-col gap-1">
                <h1 className="m-0 font-sans text-[30px] font-bold tracking-[-0.6px] text-foreground sm:text-[22px] sm:tracking-normal">
                  {t('driverSignIn.title')}
                </h1>
                <p className="type-body-medium m-0 text-muted-foreground">{t('driverSignIn.subtitle')}</p>
              </div>
              <Field label={t('driverSignIn.phone')} hint={t('driverSignIn.phoneHint')} error={phoneErrors.phone?.message}>
                {(control) => (
                  <Input
                    {...control}
                    {...phoneForm.register('phone', { required: t('driverSignIn.phoneRequired') })}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    autoFocus
                    placeholder="077 604 1932"
                    className="h-[52px] text-[16px]"
                  />
                )}
              </Field>
              {alert}
              <div className="flex-1 sm:hidden" />
              <Button type="submit" variant="primary" className="h-[52px] w-full text-[16px]" loading={sendingCode}>
                {t('driverSignIn.sendCode')}
              </Button>
              <Link to="/sign-in" className="type-body self-center font-medium text-primary">
                {t('driverSignIn.emailInstead')}
              </Link>
            </form>
          ) : (
            <form noValidate onSubmit={(e) => void onCode(e)} className="flex flex-1 flex-col gap-5 px-5 pb-6 pt-8 sm:flex-none sm:gap-[18px] sm:p-6">
              <div className="flex flex-col gap-1">
                <h1 className="m-0 font-sans text-[30px] font-bold tracking-[-0.6px] text-foreground sm:text-[22px] sm:tracking-normal">
                  {t('driverSignIn.codeTitle')}
                </h1>
                <p className="type-body-medium m-0 text-muted-foreground">{t('driverSignIn.codeSubtitle', { phone: phoneNumber })}</p>
              </div>
              <Field label={t('driverSignIn.code')} error={codeErrors.code?.message}>
                {(control) => (
                  <Input
                    {...control}
                    {...codeForm.register('code', {
                      required: t('driverSignIn.codeRequired'),
                      pattern: { value: /^\d{6}$/, message: t('driverSignIn.codeRequired') },
                    })}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={CODE_LENGTH}
                    className="h-[52px] font-mono text-[20px] tracking-[0.3em]"
                  />
                )}
              </Field>
              <p className="type-caption m-0 text-muted-foreground">
                {t('driverSignIn.demoHint')}{' '}
                <Link to="/demo/inbox" target="_blank" rel="noreferrer" className="font-medium text-primary">
                  {t('driverSignIn.demoInbox')}
                </Link>
                .
              </p>
              {alert}
              <div className="flex-1 sm:hidden" />
              <Button type="submit" variant="primary" className="h-[52px] w-full text-[16px]" loading={verifying}>
                {t('driverSignIn.submit')}
              </Button>
              <div className="flex items-center justify-between">
                <Button type="button" variant="ghost" disabled={resendIn > 0} onClick={() => void sendCode(phoneNumber)}>
                  {resendIn > 0 ? t('driverSignIn.resendIn', { seconds: resendIn }) : t('driverSignIn.resend')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setPhoneNumber(null)
                    setRefusal(null)
                    codeForm.reset()
                  }}
                >
                  {t('driverSignIn.changeNumber')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
