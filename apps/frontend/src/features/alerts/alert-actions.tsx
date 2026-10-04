// Figma: 01 Dashboard · 488:8577 (banner buttons) and 19 Tracking · 185:17224 (the alert card's
// Re-sequence / Reassign / Update ETA / Defer stop row)
import { useAlertsAcknowledge, useAlertsResolve, type AlertDto } from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { getLink, isLink, type Link } from '@/lib/links'
import { Action } from '@/ui/action'
import { Button, type ButtonVariant } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { toast } from '@/ui/toast-store'
import { DecideFlagDialog } from '@/features/loading/decide-flag-dialog'
import { flagIdOfDecideLink } from '@/features/loading/loading-copy'

/**
 * The relations a fix link can come back as, and the screen that performs each
 * one. The server decides *whether* a viewer is offered the fix (it sends the
 * link only when their permission allows it); this decides *where* the fix
 * happens, which is a question only the web app can answer.
 *
 * `null` means the screen that does it is not built yet. The button still
 * appears, because the server says this dispatcher may take the action and
 * hiding it would misreport what they can do — it is disabled and says which
 * screen it is waiting on.
 */
const FIX_SCREENS: Record<string, { to: (alert: AlertDto) => string | null; waitingOn?: string }> = {
  resequence: { to: (a) => (a.tripId ? `/dispatch/trips/${a.tripId}` : null), waitingOn: '19b Re-sequence' },
  reassign: { to: (a) => (a.tripId ? `/dispatch/trips/${a.tripId}` : null), waitingOn: '20 Reassign' },
  defer: { to: (a) => (a.tripId ? `/dispatch/trips/${a.tripId}` : null), waitingOn: '19a Trip details' },
  tracking: { to: (a) => (a.tripId ? `/dispatch/trips/${a.tripId}` : null) },
  deferral: { to: () => '/dispatch/deferrals' },
  // `decide` is handled by DecideButton, which opens the decision dialog instead of navigating.
  issue: { to: () => null, waitingOn: "M6 the store's issue" },
  resolveConflict: { to: () => null, waitingOn: '19c Sync conflicts' },
}

/** The relations that are fixes, in the order the frames put their buttons. */
const FIX_ORDER = ['resequence', 'reassign', 'decide', 'defer', 'issue', 'deferral', 'resolveConflict', 'tracking']

export interface AlertActionsProps {
  alert: AlertDto
  /** 19's card leads with a filled button; 01's banner leads with Resolve. */
  emphasis?: 'fix' | 'resolve'
  size?: 'sm' | 'default'
  /**
   * Called when the viewer acknowledges or resolves this alert. Acting on an
   * alert changes where it sorts, so the list it came from uses this to keep
   * it in view instead of letting the card jump to the next one.
   */
  onAct?: (alert: AlertDto) => void
}

/**
 * Every action the alert offers this viewer, and nothing else. Each button
 * exists because the resource carried the matching `_links` entry, never
 * because of a role check in here (the affordance rule, AC-ALR-07).
 */
export function AlertActions({ alert, emphasis = 'fix', size = 'sm', onAct }: AlertActionsProps) {
  const qc = useQueryClient()
  const [resolving, setResolving] = useState(false)

  const acknowledge = useAlertsAcknowledge({
    mutation: {
      onSuccess: () => {
        toast({ title: "You're on it", description: 'The other dispatchers can see that now.' })
        onAct?.(alert)
        void invalidate(qc)
      },
    },
  })

  const fixes = FIX_ORDER.map((rel) => ({ rel, link: getLink(alert._links, rel) })).filter(
    (entry): entry is { rel: string; link: Link } => Boolean(entry.link),
  )

  const acknowledgeLink = getLink(alert._links, 'acknowledge')
  const resolveLink = getLink(alert._links, 'resolve')
  if (fixes.length === 0 && !acknowledgeLink && !resolveLink) return null

  const leadFix = emphasis === 'fix'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {fixes.map(({ rel, link }, index) =>
        rel === 'decide' ? (
          <DecideButton
            key={rel}
            link={link}
            alert={alert}
            size={size}
            variant={leadFix && index === 0 ? 'default' : 'outline'}
            onDecided={onAct}
          />
        ) : (
          <FixButton
            key={rel}
            rel={rel}
            link={link}
            alert={alert}
            size={size}
            variant={leadFix && index === 0 ? 'default' : 'outline'}
          />
        ),
      )}

      {isLink(acknowledgeLink) ? (
        <Action
          link={acknowledgeLink}
          size={size}
          variant="outline"
          loading={acknowledge.isPending}
          onAction={({ headers }) =>
            acknowledge.mutateAsync({ id: alert.id, headers } as Parameters<typeof acknowledge.mutateAsync>[0])
          }
        />
      ) : null}

      {isLink(resolveLink) ? (
        <>
          <Button size={size} variant={leadFix ? 'outline' : 'default'} onClick={() => setResolving(true)}>
            {resolveLink.title ?? 'Resolve'}
          </Button>
          <ResolveDialog alert={alert} open={resolving} onOpenChange={setResolving} onResolved={onAct} />
        </>
      ) : null}
    </div>
  )
}

/**
 * "Decide the flag" opens the decision dialog over the panel, because the answer needs the flag in
 * front of the dispatcher (what, how many, who, why) and a choice, not a different page. Once the
 * flag is decided the alert closes itself and the loader's tablet moves to L3b over SSE.
 */
function DecideButton({
  link,
  alert,
  size,
  variant,
  onDecided,
}: {
  link: Link
  alert: AlertDto
  size: 'sm' | 'default'
  variant: ButtonVariant
  onDecided?: (alert: AlertDto) => void
}) {
  const [open, setOpen] = useState(false)
  const flagId = flagIdOfDecideLink(link.href)
  if (!flagId)
    return (
      <Button size={size} variant="outline" disabled>
        {link.title ?? 'Decide the flag'}
      </Button>
    )
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        {link.title ?? 'Decide the flag'}
      </Button>
      <DecideFlagDialog flagId={flagId} open={open} onOpenChange={setOpen} onDecided={() => onDecided?.(alert)} />
    </>
  )
}

/**
 * A fix link as a button. It navigates: the link points at the API endpoint
 * that fixes the problem, and the dispatcher needs the screen that calls it,
 * with its reason codes and its If-Match.
 */
function FixButton({
  rel,
  link,
  alert,
  size,
  variant,
}: {
  rel: string
  link: Link
  alert: AlertDto
  size: 'sm' | 'default'
  variant: ButtonVariant
}) {
  const screen = FIX_SCREENS[rel]
  const to = screen?.to(alert) ?? null
  const label = link.title ?? rel

  // A fix with no screen yet is always outlined, never the filled primary:
  // the emphasised button on a card is the one thing the dispatcher should
  // press, and it would be odd for that to be the one they cannot.
  if (!to) {
    return (
      <Button size={size} variant="outline" disabled title={screen?.waitingOn ? `Opens on ${screen.waitingOn}` : undefined}>
        {label}
      </Button>
    )
  }
  return (
    <Button asChild size={size} variant={variant}>
      <RouterLink to={to}>{label}</RouterLink>
    </Button>
  )
}

/**
 * Resolving by hand needs a note saying what was done; the server refuses an
 * empty one with a 400 on `note` (AC-ALR-08), and this keeps the dispatcher
 * from meeting that refusal in the first place.
 */
function ResolveDialog({
  alert,
  open,
  onOpenChange,
  onResolved,
}: {
  alert: AlertDto
  open: boolean
  onOpenChange: (open: boolean) => void
  onResolved?: (alert: AlertDto) => void
}) {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const resolve = useAlertsResolve({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Alert resolved', description: 'It has left the panel.', tone: 'success' })
        onOpenChange(false)
        setNote('')
        onResolved?.(alert)
        void invalidate(qc)
      },
    },
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !resolve.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader title="Resolve this alert" description={alert.title} />
        <DialogBody>
          <Field label="What did you do about it?" hint={`Normally it closes itself when ${alert.resolvesWhen}.`}>
            {(control) => (
              <textarea
                {...control}
                className="type-body min-h-[88px] w-full rounded-md border border-slate-300 bg-background px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={resolve.isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={resolve.isPending}
            disabled={note.trim() === ''}
            onClick={() => void resolve.mutateAsync({ id: alert.id, data: { note } })}
          >
            Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Both writes change the list and the alert, and `alert.acknowledged` and
 * `alert.resolved` reach every other dispatcher over SSE; this is for the one
 * who pressed the button, whose own panel should not wait for the round trip.
 */
const invalidate = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({
    predicate: (query) => {
      const [key] = query.queryKey
      return typeof key === 'string' && key.startsWith('/api/v1/alerts')
    },
  })
