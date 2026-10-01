import { isApiProblem } from '@compass/api-client'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button } from './button'

export interface EmptyStateProps {
  title: ReactNode
  description?: ReactNode
  /** Usually an <Action> for the create link. */
  action?: ReactNode
  className?: string
}

/** For lists that can be empty. Take the copy from the Figma frame. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
      <p className="type-body-strong m-0 text-foreground">{title}</p>
      {description ? <p className="type-body m-0 max-w-[420px] text-muted-foreground">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}

export interface ErrorStateProps {
  /** The query or mutation error; an ApiProblem shows its title, detail and request id. */
  error: unknown
  onRetry?: () => void
  className?: string
}

/** A failed request: the problem detail and a retry (admin, store and dispatcher shells). */
export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  const problem = isApiProblem(error) ? error : undefined
  const title = problem?.title ?? 'Something went wrong'
  const detail = problem?.detail ?? (problem ? undefined : 'Check your connection and try again.')
  return (
    <div role="alert" data-slot="error-state" className={cn('flex items-start justify-between gap-4 rounded-lg border border-status-danger-border bg-status-danger-bg px-[17px] py-[13px]', className)}>
      <div className="flex flex-col gap-0.5">
        <p className="type-body-strong m-0 text-destructive-foreground">{title}</p>
        {detail ? <p className="type-body m-0 text-slate-700">{detail}</p> : null}
        {problem?.requestId ? <p className="type-mono-small m-0 pt-1 text-muted-foreground">Request {problem.requestId}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}
