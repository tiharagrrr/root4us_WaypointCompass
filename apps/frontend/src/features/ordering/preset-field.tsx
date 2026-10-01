// Figma: M1 New order · 185:10376 ("Field / Preset for this order")
import type { OrderTemplateDto } from '@compass/api-client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

export interface PresetFieldProps {
  templates: readonly OrderTemplateDto[]
  /** The preset this order was started from, if any. */
  value: string | null
  onApply: (template: OrderTemplateDto) => void
  /** Open state, so the header's "Load a saved preset" can open the same picker. */
  open: boolean
  onOpenChange: (open: boolean) => void
  loading?: boolean
  /** Without the setLines link the order cannot take a preset any more (it is sent, or past cutoff). */
  canApply: boolean
}

/**
 * The saved line sets for this order's class. Choosing one replaces the order's lines, so it only
 * appears while the server still offers the setLines link.
 */
export function PresetField({ templates, value, onApply, open, onOpenChange, loading, canApply }: PresetFieldProps) {
  if (!canApply) return null
  const empty = !loading && templates.length === 0
  return (
    <div className="flex flex-col gap-1.5 pt-2">
      <label className="type-label uppercase text-muted-foreground" id="preset-for-this-order">
        Preset for this order
      </label>
      <Select
        open={open}
        onOpenChange={onOpenChange}
        value={value ?? undefined}
        disabled={loading || empty}
        onValueChange={(id) => {
          const template = templates.find((t) => t.id === id)
          if (template) onApply(template)
        }}
      >
        <SelectTrigger size="sm" aria-labelledby="preset-for-this-order">
          <SelectValue placeholder={loading ? 'Loading…' : empty ? 'No presets saved yet' : 'Choose a preset'} />
        </SelectTrigger>
        <SelectContent>
          {templates.map((template) => (
            <SelectItem key={template.id} value={template.id}>
              {template.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
