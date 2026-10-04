// Not in Figma: the published plan's version of 08 and 10 asks why it changes (AC-PLN-21).
import { useDeferralReasonsList } from '@compass/api-client'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

export interface RevisionReason {
  reasonCode?: string
  note: string
}

export interface RevisionReasonBarProps {
  revision: number
  value: RevisionReason
  onChange: (value: RevisionReason) => void
}

/**
 * A published plan changes only as a revision with a reason: the bar names the revision it makes,
 * says who hears about it, and takes the reason code and a note before the wizard can save. The
 * codes are the admin's deferral reasons (A6), the same list the dispatcher uses for deferrals.
 */
export function RevisionReasonBar({ revision, value, onChange }: RevisionReasonBarProps) {
  const reasons = (useDeferralReasonsList().data?.data ?? []).filter((r) => r.active)
  return (
    <section aria-label="Revision reason" className="flex flex-col gap-2 border-t border-status-warning-border bg-status-warning-bg px-5 py-3">
      <p className="type-body-small m-0 text-foreground">
        This plan is published. Saving makes <strong>revision {revision + 1}</strong>; only the drivers, loaders and stores it touches are told.
      </p>
      <div className="flex items-center gap-2">
        <Select value={value.reasonCode ?? ''} onValueChange={(reasonCode) => onChange({ ...value, reasonCode })}>
          <SelectTrigger aria-label="Reason" className="w-[240px]">
            <SelectValue placeholder="Pick a reason" />
          </SelectTrigger>
          <SelectContent>
            {reasons.map((r) => (
              <SelectItem key={r.code} value={r.code}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label="Note"
          className="flex-1"
          maxLength={500}
          placeholder="What changed, for the people it touches (optional)"
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
      </div>
    </section>
  )
}
