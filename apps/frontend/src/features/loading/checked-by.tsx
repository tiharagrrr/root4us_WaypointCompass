// Figma: L2 Loading list · 185:19377 (the dock tablet is shared, so every tick carries a name)
import { useLoadingBoardLoaders, useMeGet } from '@compass/api-client'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useCheckedByName, useDockLoaders } from '@/offline'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Combobox } from '@/ui/combobox'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'

export interface CheckedBy {
  /** The name set for the whole tablet, or null when each item is signed on its own. */
  name: string | null
  /** Runs the write with the tablet's name, or asks who checked this one item when there is none. */
  withName: (run: (name: string) => void) => void
  /** Sets, changes or clears the tablet's name, for the loader who takes over mid-trip. */
  change: () => void
  dialog: ReactNode
}

/**
 * Four loaders share one dock tablet, so the account says whose tablet it is and this says who
 * actually looked in the crate (AC-LOD-03). A name set from the header is kept in Dexie and signs
 * every item until someone changes or clears it. With no tablet name, each tick, undo, re-check
 * and release asks who did that one, so loaders working the same trip sign their own items.
 *
 * The name is picked from the depot's roster (A6), filtered as it is typed; a name not on the
 * roster still saves. The roster is kept in Dexie, so the picker works with no signal (AC-LOD-20).
 */
export function useCheckedBy(): CheckedBy {
  const { t } = useTranslation()
  const [name, setName] = useCheckedByName()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [forAll, setForAll] = useState(false)
  // The last name used for a single item, so the next item offers it first.
  const [lastItemName, setLastItemName] = useState('')
  const queued = useRef<((name: string) => void) | null>(null)
  // Asked for one item (from a tick) or for the tablet (from the header).
  const [perItem, setPerItem] = useState(false)
  const depotId = useMeGet().data?.data.depotId ?? ''
  const roster = useLoadingBoardLoaders(depotId, { query: { enabled: depotId !== '' } })
  const [cached, cache] = useDockLoaders()
  const fresh = roster.data?.data.names
  useEffect(() => {
    if (fresh) void cache(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cache is a new function each render
  }, [fresh])
  const options = useMemo(() => [...new Set([...(fresh ?? cached), ...(name ? [name] : [])])], [fresh, cached, name])

  const ask = (run?: (name: string) => void) => {
    queued.current = run ?? null
    setPerItem(Boolean(run))
    setDraft(run ? lastItemName : (name ?? ''))
    setForAll(false)
    setOpen(true)
  }

  const withName = (run: (name: string) => void) => {
    if (name) {
      run(name)
      return
    }
    ask(run)
  }

  const close = () => {
    queued.current = null
    setOpen(false)
  }

  const save = async (value: string = draft) => {
    const typed = value.trim()
    const run = queued.current
    // From the header the field is the tablet's name: saving it empty clears it, so each item is
    // asked for again. An item can't be signed by nobody, so it needs a name.
    if (!run) {
      await setName(typed === '' ? null : typed)
      close()
      return
    }
    if (typed === '') return
    if (forAll) await setName(typed)
    else setLastItemName(typed)
    close()
    run(typed)
  }

  const dialog = (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent>
        <DialogHeader
          title={perItem ? t('loading.checkedBy.itemTitle') : t('loading.checkedBy.title')}
          description={perItem ? t('loading.checkedBy.itemDescription') : t('loading.checkedBy.description')}
        />
        <DialogBody>
          <Field label={t('loading.checkedBy.label')}>
            {(control) => (
              <Combobox
                {...control}
                autoFocus
                value={draft}
                onValueChange={setDraft}
                options={options}
                emptyText={(typed) => t('loading.checkedBy.newName', { name: typed })}
                placeholder={perItem ? t('loading.checkedBy.placeholder') : t('loading.checkedBy.tabletPlaceholder')}
                className="h-11 text-[15px]"
              />
            )}
          </Field>
          {perItem ? (
            <label className="type-body flex min-h-[var(--compass-size-touch-target)] cursor-pointer items-center gap-2.5 text-foreground">
              <Checkbox checked={forAll} onCheckedChange={(on) => setForAll(on === true)} />
              {t('loading.checkedBy.useForAll')}
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="lg" disabled={perItem && draft.trim() === ''} onClick={() => void save()}>
            {t('loading.checkedBy.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { name, withName, change: () => ask(), dialog }
}
