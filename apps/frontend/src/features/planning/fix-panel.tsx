// Figma: 11 Over capacity · 269:2996, the red panel under the trip's meters.
import type { FixSuggestion, Violation } from '@waypoint/engine'
import { Button } from '@/ui/button'

export interface FixPanelProps {
  problem: Violation
  fixes: readonly FixSuggestion[]
  /** An order's outlet name, for "Remove Kandana". */
  outletOf: (orderId: string) => string | undefined
  onApply: (fix: FixSuggestion) => void
  applying: boolean
}

interface Shown {
  fix: FixSuggestion
  label: string
}

/** A fix's button in the frame's words: "Move to REF-03", "Remove Kandana", or the engine's own label. */
function shortLabel(fix: FixSuggestion, outletOf: FixPanelProps['outletOf']): string {
  const move = fix.edits.find((e) => e.op === 'MOVE_ORDER')
  if (fix.kind === 'MOVE' && move && 'tripKey' in move) return `Move to ${move.tripKey.split('#')[0]}`
  const names = fix.edits.flatMap((e) => (e.op === 'UNASSIGN_ORDER' ? [outletOf(e.orderId)] : []))
  if (fix.kind === 'DEFER' && names.length && names.every(Boolean)) return `Remove ${names.join(' and ')}`
  return fix.label
}

/**
 * 11: what is wrong with the trip, in the engine's words, and the best few ways to clear it. Each
 * way is the engine's own suggestion (suggestFixes), checked to clear the problem without causing
 * a hard one; applying it saves the draft and the fix as one edit list.
 */
export function FixPanel({ problem, fixes, outletOf, onApply, applying }: FixPanelProps) {
  const shown: Shown[] = []
  for (const kind of ['DEFER', 'MOVE', 'SWAP'] as const) {
    const fix = fixes.find((f) => f.kind === kind)
    if (fix) shown.push({ fix, label: shortLabel(fix, outletOf) })
  }
  return (
    <section
      aria-label="What to fix"
      className="flex flex-col gap-2 rounded-md border border-status-danger-border bg-status-danger-bg px-[13px] py-[11px]"
    >
      <h4 className="type-card-title m-0 text-status-danger-fg">{problem.message}</h4>
      <p className="type-body m-0 text-foreground">
        {shown.length ? 'Try one of these. Each one is checked against every rule before it is offered.' : 'No single change clears this. Remove a stop or try another vehicle.'}
      </p>
      {shown.length ? (
        <div className="flex flex-wrap gap-2">
          {shown.map(({ fix, label }) => (
            <Button key={label} variant="outline" size="sm" disabled={applying} title={fix.label} onClick={() => onApply(fix)}>
              {label}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
