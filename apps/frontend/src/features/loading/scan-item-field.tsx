// Figma: L2 Loading list · 185:19377 (Button / Scan item)
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { isSettled } from './loading-copy'
import type { LoadLineView } from './use-load-list'

export interface ScanItemFieldProps {
  lines: readonly LoadLineView[]
  disabled?: boolean
  onFound: (line: LoadLineView) => void
}

/**
 * The dock's scanners are keyboard wedges: they type the code and press Enter. So "Scan item"
 * opens a field rather than a camera, and a code that is not on this list says so instead of
 * silently ticking the nearest thing.
 *
 * It ticks through the same path as the tick button, so a scan is a queued check like any other.
 */
export function ScanItemField({ lines, disabled = false, onFound }: ScanItemFieldProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [miss, setMiss] = useState<string | null>(null)

  const submit = () => {
    const typed = code.trim().toLowerCase()
    if (typed === '') return
    const match = lines.find(
      (line) => !isSettled(line.status) && Boolean(getLink(line._links, 'check')) && (line.sku ?? '').toLowerCase() === typed,
    )
    setCode('')
    if (!match) {
      setMiss(typed)
      return
    }
    setMiss(null)
    onFound(match)
  }

  if (!open) {
    return (
      <Button className="h-11 px-[21px] text-[15px]" disabled={disabled} onClick={() => setOpen(true)}>
        {t('loading.scanItem')}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        aria-label={t('loading.scanItem')}
        placeholder={t('loading.scanPlaceholder')}
        value={code}
        disabled={disabled}
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
          if (event.key === 'Escape') setOpen(false)
        }}
        className="h-11 w-[200px] text-[15px]"
      />
      <Button variant="outline" className="h-11" onClick={() => setOpen(false)}>
        {t('common.done')}
      </Button>
      {miss ? (
        <p role="status" className="type-body m-0 text-destructive-foreground">
          {t('loading.scanNoMatch', { code: miss })}
        </p>
      ) : null}
    </div>
  )
}
