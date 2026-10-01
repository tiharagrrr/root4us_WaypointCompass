import { useCallback, useState } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './icon'

// Figma: L1 Sign in · 185:19312 and L1m · 254:1243. Four dots over a 3 × 4 keypad; Clear, 0 and
// backspace fill the last row. A dock tablet is shared, so nothing is ever remembered here.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export interface PinKeypadProps {
  /** How many digits the PIN has (L1 draws four dots). */
  length?: number
  /** Called once the last digit is typed; the screen signs in from here. */
  onComplete: (pin: string) => void
  /** Clears the entry and the dots, e.g. after a wrong PIN. */
  resetKey?: string | number
  disabled?: boolean
  className?: string
  /** Accessible name for the group of keys. */
  label?: string
}

export function PinKeypad({ length = 4, onComplete, resetKey, disabled = false, className, label = 'PIN keypad' }: PinKeypadProps) {
  const [pin, setPin] = useState('')
  const [lastReset, setLastReset] = useState(resetKey)

  // Reset while rendering rather than in an effect, so the cleared dots never flash on screen
  // (react.dev, "You might not need an effect": adjusting state when a prop changes).
  if (resetKey !== lastReset) {
    setLastReset(resetKey)
    setPin('')
  }

  const press = useCallback(
    (digit: string) => {
      if (disabled) return
      setPin((current) => {
        if (current.length >= length) return current
        const next = current + digit
        if (next.length === length) onComplete(next)
        return next
      })
    },
    [disabled, length, onComplete],
  )

  const key =
    'flex h-[72px] cursor-pointer items-center justify-center rounded-md border border-border bg-background text-foreground outline-none transition-colors hover:bg-slate-100 active:bg-slate-200 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40'

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center justify-center gap-2.5" role="status" aria-label={`${pin.length} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} data-filled={i < pin.length} className={cn('size-2.5 rounded-full border', i < pin.length ? 'border-ink bg-ink' : 'border-slate-300')} />
        ))}
      </div>

      <div role="group" aria-label={label} className="grid grid-cols-3 gap-2.5">
        {KEYS.map((digit) => (
          <button key={digit} type="button" disabled={disabled} onClick={() => press(digit)} className={cn(key, 'font-sans text-[20px] font-bold')}>
            {digit}
          </button>
        ))}
        <button type="button" disabled={disabled || pin === ''} onClick={() => setPin('')} className={cn(key, 'type-body')}>
          Clear
        </button>
        <button type="button" disabled={disabled} onClick={() => press('0')} className={cn(key, 'font-sans text-[20px] font-bold')}>
          0
        </button>
        <button
          type="button"
          aria-label="Backspace"
          disabled={disabled || pin === ''}
          onClick={() => setPin((current) => current.slice(0, -1))}
          className={key}
        >
          <Icon name="backspace" size={22} className="text-slate-700" />
        </button>
      </div>
    </div>
  )
}
