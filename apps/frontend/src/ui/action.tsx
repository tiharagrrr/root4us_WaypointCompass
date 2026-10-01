import { useState, type ReactNode } from 'react'
import { isLink, requires, type Link } from '@/lib/links'
import { Button, type ButtonProps } from './button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from './dialog'

export interface ActionContext {
  link: Link
  /** New for every press. Send it as Idempotency-Key so a retry of this press replays, not repeats. */
  idempotencyKey: string
  /** Headers for the request: Idempotency-Key, plus If-Match when the link requires it. */
  headers: Record<string, string>
}

export interface ActionConfirm {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
}

export interface ActionProps extends Omit<ButtonProps, 'onClick' | 'children' | 'asChild'> {
  /**
   * The resource's _links entry, e.g. user._links.deactivate. When it is missing (or not a link)
   * nothing renders: the server decides which actions exist (the hypermedia rule).
   */
  link: unknown
  /** Button label; defaults to the link's title. */
  children?: ReactNode
  /** Runs the action. Return the mutation's promise to show the loading state until it settles. */
  onAction: (context: ActionContext) => unknown
  /** The resource version for If-Match when the link requires it (W/"<version>"). */
  version?: number | string
  /** Ask first, for destructive or hard-to-undo actions. */
  confirm?: ActionConfirm
}

/**
 * A button that exists only when the resource carries the matching link. One Idempotency-Key per
 * press, If-Match when the link requires it, and an optional confirm step. Errors stay with the
 * caller's mutation state.
 */
export function Action({ link, children, onAction, version, confirm, loading, variant, ...buttonProps }: ActionProps) {
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)

  if (!isLink(link)) return null

  const run = async () => {
    const idempotencyKey = globalThis.crypto.randomUUID()
    const headers: Record<string, string> = { 'Idempotency-Key': idempotencyKey }
    if (requires(link, 'If-Match') && version !== undefined) headers['If-Match'] = `W/"${version}"`
    setPending(true)
    try {
      await onAction({ link, idempotencyKey, headers })
    } catch {
      // The caller's mutation holds the error and the screen shows it.
    } finally {
      setPending(false)
      setConfirming(false)
    }
  }

  const label = children ?? link.title
  const busy = loading || pending

  return (
    <>
      <Button
        {...buttonProps}
        variant={variant}
        loading={busy}
        onClick={() => (confirm ? setConfirming(true) : void run())}
      >
        {label}
      </Button>
      {confirm ? (
        <Dialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
          <DialogContent>
            <DialogHeader title={confirm.title} />
            {confirm.description ? (
              <DialogBody>
                <p className="type-body m-0 text-slate-700">{confirm.description}</p>
              </DialogBody>
            ) : null}
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
                {confirm.cancelLabel ?? 'Cancel'}
              </Button>
              <Button variant={variant} loading={pending} onClick={() => void run()}>
                {confirm.confirmLabel ?? label}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
