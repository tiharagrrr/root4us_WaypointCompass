// Figma: L2 Loading list · 185:19377 (the dock tablet is shared, so every tick carries a name)
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useCheckedByName } from '@/offline'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'

export interface CheckedBy {
  /** The name typed on this tablet, or null until someone types one. */
  name: string | null
  /** Runs the write with the name, asking for one first when the tablet does not have it yet. */
  withName: (run: (name: string) => void) => void
  /** Reopens the question, for the loader who takes over the tablet mid-trip. */
  change: () => void
  dialog: ReactNode
}

/**
 * Four loaders share one dock tablet, so the account says whose tablet it is and this says who
 * actually looked in the crate (AC-LOD-03). The name is asked once and kept in Dexie until someone
 * changes it, because a prompt on every tick would be answered with whatever is quickest to type.
 */
export function useCheckedBy(): CheckedBy {
  const { t } = useTranslation()
  const [name, setName] = useCheckedByName()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const queued = useRef<((name: string) => void) | null>(null)

  const ask = (run?: (name: string) => void) => {
    queued.current = run ?? null
    setDraft(name ?? '')
    setOpen(true)
  }

  const withName = (run: (name: string) => void) => {
    if (name) {
      run(name)
      return
    }
    ask(run)
  }

  const save = async () => {
    const typed = draft.trim()
    if (typed === '') return
    await setName(typed)
    setOpen(false)
    const run = queued.current
    queued.current = null
    run?.(typed)
  }

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader title={t('loading.checkedBy.title')} description={t('loading.checkedBy.description')} />
        <DialogBody>
          <Field label={t('loading.checkedBy.label')}>
            {(control) => (
              <Input
                {...control}
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save()
                }}
                className="h-11 text-[15px]"
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="lg" disabled={draft.trim() === ''} onClick={() => void save()}>
            {t('loading.checkedBy.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { name, withName, change: () => ask(), dialog }
}
