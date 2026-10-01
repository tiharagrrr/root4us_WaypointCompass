// No frame: the invite landing (/invite/:token) reuses A0 Sign in's card · 185:8713
import {
  getMeGetQueryOptions,
  isApiProblem,
  useInvitationsAccept,
  useInvitationsByToken,
  type AcceptInvitationDto,
} from '@compass/api-client'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router'
import { queryClient } from '@/app/query-client'
import { applyProblem } from '@/lib/apply-problem'
import { formatColombo } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { roleLabel } from '@/lib/roles'
import { Button } from '@/ui/button'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { Skeleton } from '@/ui/skeleton'
import { Wordmark } from '@/ui/wordmark'
import { authClient } from './auth-client'
import { toPhone } from './contact'
import { ROLE_HOME } from './role-home'

type AcceptForm = Required<Pick<AcceptInvitationDto, 'email' | 'password' | 'phoneNumber' | 'code' | 'pin'>>

const LABELS: Record<keyof AcceptForm, string> = {
  email: 'Email',
  password: 'Choose a password',
  phoneNumber: 'Phone',
  code: 'Code from the SMS',
  pin: 'Choose a 4-digit dock PIN',
}

const CLOSED: Record<string, string> = {
  EXPIRED: 'This invitation has expired. Ask your admin to send it again.',
  ACCEPTED: 'This invitation has been used. Sign in instead.',
  REVOKED: 'This invitation was withdrawn. Ask your admin for a new one.',
}

/**
 * Accept an invitation: email roles set a password, drivers prove their phone with a code, loaders
 * choose their dock PIN. Email roles and drivers are signed in straight away.
 */
export function InviteLandingPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const invitation = useInvitationsByToken(token, { query: { retry: false } })
  const accept = useInvitationsAccept()
  const [done, setDone] = useState<string | null>(null)
  const [codeSent, setCodeSent] = useState(false)
  const form = useForm<AcceptForm>({ defaultValues: { email: '', password: '', phoneNumber: '', code: '', pin: '' } })
  const { errors, isSubmitting } = form.formState
  const data = invitation.data?.data
  const fields = (data?.accepts ?? []) as (keyof AcceptForm)[]

  const sendCode = async () => {
    const phoneNumber = toPhone(form.getValues('phoneNumber'))
    const result = await authClient.phoneNumber.sendOtp({ phoneNumber })
    if (result.error) form.setError('phoneNumber', { message: result.error.status === 429 ? 'Too many codes. Wait a few minutes.' : 'The code was not sent. Check the number.' })
    else setCodeSent(true)
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const body: AcceptInvitationDto = Object.fromEntries(
      fields.map((f) => [f, f === 'phoneNumber' ? toPhone(values[f]) : values[f].trim()]),
    )
    try {
      const accepted = await accept.mutateAsync({ token, data: body })
      if (!accepted.data.signedIn) {
        setDone(`Your account is ready, ${accepted.data.name}. Sign in at the dock tablet with your PIN.`)
        return
      }
    } catch (error) {
      if (!isApiProblem(error)) throw error
      applyProblem(form, error, { fields })
      return
    }
    queryClient.clear()
    const me = await queryClient.fetchQuery(getMeGetQueryOptions())
    void navigate(ROLE_HOME[me.data.role], { replace: true })
  })

  return (
    <main className="flex min-h-svh items-center justify-center bg-page px-4">
      <div className="flex w-[400px] flex-col gap-6">
        <div className="flex h-8 items-start justify-center">
          <Wordmark size="lg" />
        </div>
        <div className="flex flex-col gap-[18px] rounded-lg border border-border bg-background p-7 shadow-sm">
          {invitation.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : invitation.error || !data ? (
            <Message title="This link does not work" text="It may have been replaced by a newer invitation. Ask your admin to send it again." />
          ) : done ? (
            <Message title="You are set up" text={done} />
          ) : data.status !== 'PENDING' ? (
            <Message title={`Hello, ${data.name}`} text={CLOSED[data.status] ?? 'This invitation cannot be used.'} />
          ) : (
            <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-[18px]">
              <div className="flex flex-col gap-1">
                <h1 className="m-0 font-sans text-[22px] font-bold leading-auto text-foreground">Welcome, {data.name}</h1>
                <p className="m-0 font-sans text-[14px] leading-[20.3px] text-muted-foreground">
                  You are invited as {roleLabel(data.role).toLowerCase()}. This link works until {formatColombo(data.expiresAt, 'EEE d MMM HH:mm')}.
                </p>
              </div>
              {fields.map((field) => (
                <Field
                  key={field}
                  label={LABELS[field]}
                  error={errors[field]?.message}
                  hint={field === 'phoneNumber' && data.phoneNumber ? `The number ending ${data.phoneNumber.slice(-4)}` : field === 'email' && data.email ? `Use ${data.email}` : undefined}
                >
                  {(control) =>
                    field === 'code' ? (
                      <div className="flex gap-2">
                        <Input {...control} {...form.register('code', { required: 'Enter the 6-digit code' })} inputMode="numeric" maxLength={6} className="h-11 font-mono text-[15px]" />
                        {getLink(data._links, 'sendCode') ? (
                          <Button type="button" variant="outline" className="h-11" onClick={() => void sendCode()}>
                            {codeSent ? 'Send again' : 'Send me a code'}
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <Input
                        {...control}
                        {...form.register(field, { required: `Enter your ${LABELS[field].toLowerCase()}` })}
                        type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
                        inputMode={field === 'pin' || field === 'phoneNumber' ? 'numeric' : undefined}
                        autoComplete={field === 'password' ? 'new-password' : field === 'email' ? 'email' : 'off'}
                        maxLength={field === 'pin' ? 4 : undefined}
                        className="h-11 text-[15px]"
                      />
                    )
                  }
                </Field>
              ))}
              {errors.root?.server ? (
                <p role="alert" className="type-body m-0 rounded-md border border-status-danger-border bg-status-danger-bg px-3 py-2 text-destructive-foreground">
                  {errors.root.server.message}
                </p>
              ) : null}
              {getLink(data._links, 'accept') ? (
                <Button type="submit" variant="primary" size="lg" loading={isSubmitting} className="h-11 w-full text-[15px]">
                  Accept and continue
                </Button>
              ) : null}
            </form>
          )}
        </div>
      </div>
    </main>
  )
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="m-0 font-sans text-[22px] font-bold leading-auto text-foreground">{title}</h1>
      <p className="m-0 font-sans text-[14px] leading-[20.3px] text-muted-foreground">{text}</p>
    </div>
  )
}
