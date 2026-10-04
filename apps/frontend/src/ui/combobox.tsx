import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { Input, type InputProps } from './input'

export interface ComboboxProps extends Omit<InputProps, 'value' | 'onChange' | 'leading'> {
  value: string
  onValueChange: (value: string) => void
  /** The values to offer; the list shows those containing what is typed, ignoring case. */
  options: readonly string[]
  /** Enter on a typed value with the list closed (or a picked option): commit it. */
  onCommit?: (value: string) => void
  /** The empty-list line, e.g. "No match: “Kas” is saved as typed". */
  emptyText?: (typed: string) => string
}

/** Options containing the typed text, ignoring case; every option when nothing is typed. */
const filterOptions = (options: readonly string[], typed: string): string[] => {
  const needle = typed.trim().toLowerCase()
  return needle === '' ? [...options] : options.filter((o) => o.toLowerCase().includes(needle))
}

/**
 * A text field that offers matching values under it as you type (WAI-ARIA combobox with a listbox).
 * Free text stays allowed: the options suggest, they do not restrict. Arrow keys move, Enter picks
 * the highlighted option (or commits the typed text), Escape closes the list. The list sits in the
 * flow under the field rather than floating, so a dialog body that scrolls never clips it.
 */
export function Combobox({ value, onValueChange, options, onCommit, emptyText, className, onKeyDown, onFocus, onBlur, onClick, ...props }: ComboboxProps) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const matches = useMemo(() => filterOptions(options, value), [options, value])

  const pick = (option: string) => {
    onValueChange(option)
    setOpen(false)
    setActive(-1)
    onCommit?.(option)
  }

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (matches.length ? (i + 1) % matches.length : -1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (matches.length ? (i <= 0 ? matches.length - 1 : i - 1) : -1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (open && active >= 0 && matches[active] !== undefined) pick(matches[active])
      else {
        setOpen(false)
        onCommit?.(value)
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setActive(-1)
    }
  }

  const shown = open && (matches.length > 0 || (emptyText !== undefined && value.trim() !== ''))
  const activeId = active >= 0 ? `${listId}-${active}` : undefined

  return (
    <div data-slot="combobox">
      <Input
        {...props}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown ? activeId : undefined}
        autoComplete="off"
        className={className}
        value={value}
        onChange={(event) => {
          // Typing filters a list that is open; it does not open one (only a click or ↓ does).
          onValueChange(event.target.value)
          setActive(-1)
        }}
        onKeyDown={keys}
        onFocus={onFocus}
        // The list opens on a tap or click in the field (or ↓), not on focus or typing: a dialog
        // that focuses the field when it opens should not cover itself with options.
        onClick={(event) => {
          setOpen(true)
          onClick?.(event)
        }}
        onBlur={(event) => {
          setOpen(false)
          setActive(-1)
          onBlur?.(event)
        }}
      />
      {shown ? (
        <ul
          id={listId}
          role="listbox"
          className="m-0 mt-1 max-h-[220px] list-none overflow-y-auto rounded-md border border-border bg-background p-1"
        >
          {matches.map((option, i) => (
            <li
              key={option}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the input so the list does not close before the pick lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
              className={cn(
                'type-body flex min-h-[var(--compass-size-touch-target)] cursor-pointer items-center rounded-sm px-3 text-foreground',
                i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent',
              )}
            >
              {option}
            </li>
          ))}
          {matches.length === 0 && emptyText ? (
            <li role="presentation" className="type-body-small px-3 py-2.5 text-muted-foreground">
              {emptyText(value.trim())}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
