// No frame: the demo inbox (/demo/inbox) is a plain list, demo mode only (specs/identity/spec.md).
import { isApiProblem, useDemoList } from '@compass/api-client'
import { Link } from 'react-router'
import { formatColombo } from '@/lib/format-colombo'
import { Card, CardContent } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Wordmark } from '@/ui/wordmark'

/**
 * GET /demo/inbox has no response DTO, so the generated type is a loose object and the rows are
 * checked here rather than trusted. The envelope interceptor wraps the array as { data, meta }.
 */
interface DemoMessage {
  id: string
  channel: 'sms' | 'email'
  to: string
  body: string
  sentAt: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isMessage = (value: unknown): value is DemoMessage => {
  if (!isRecord(value)) return false
  const row = value
  return (
    typeof row.id === 'string' &&
    (row.channel === 'sms' || row.channel === 'email') &&
    typeof row.to === 'string' &&
    typeof row.body === 'string' &&
    typeof row.sentAt === 'string'
  )
}

/**
 * The last 50 SMS and emails the worker would have sent, newest first, so a judge can read a
 * driver's sign-in code or an invitation link without a phone. Public, like the endpoint.
 */
export function DemoInboxPage() {
  const inbox = useDemoList({ query: { refetchInterval: 5_000, retry: false } })
  const payload: unknown = inbox.data
  const rows: unknown[] = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.data) ? payload.data : []
  const messages = rows.filter(isMessage)
  const demoOff = inbox.error && isApiProblem(inbox.error) && inbox.error.status === 404

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[640px] flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-2">
        <Wordmark />
        <h1 className="type-page-title m-0 text-foreground">Demo inbox</h1>
        <p className="type-body m-0 text-muted-foreground">
          Every SMS and email the demo would have sent, newest first. Sign-in codes for drivers appear here within a few seconds.
        </p>
      </header>

      {inbox.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : demoOff ? (
        <EmptyState title="Demo mode is off" description="Set DEMO_MODE=true on the API to collect messages here instead of sending them." />
      ) : inbox.error ? (
        <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />
      ) : messages.length === 0 ? (
        <EmptyState title="Nothing yet" description="Ask for a sign-in code on the driver screen or send an invitation, then look here." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {messages.map((message) => (
            <li key={message.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={message.channel === 'sms' ? 'info' : 'neutral'}>{message.channel.toUpperCase()}</StatusChip>
                    <span className="type-mono-small text-muted-foreground">{message.to}</span>
                    <span className="type-caption ml-auto text-muted-foreground">{formatColombo(message.sentAt, 'EEE d MMM HH:mm:ss')}</span>
                  </div>
                  <p className="type-body m-0 whitespace-pre-wrap break-words text-foreground">{message.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <nav className="flex gap-4">
        <Link to="/sign-in/driver" className="type-body font-medium text-primary">
          Driver sign-in
        </Link>
        <Link to="/" className="type-body font-medium text-primary">
          Start page
        </Link>
      </nav>
    </main>
  )
}
