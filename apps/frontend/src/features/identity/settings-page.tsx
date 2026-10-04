// Figma: A6 Settings · 185:10227
import {
  getSettingsListQueryKey,
  isApiProblem,
  useClockGet,
  useSettingsList,
  useSettingsSet,
  type SettingDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { HeaderActions } from '@/app/layouts/header-actions'
import { SimulationSection } from '@/features/simulation/simulation-section'
import { cn } from '@/lib/cn'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { Switch } from '@/ui/switch'
import { toast } from '@/ui/toast-store'
import { DeferralReasonsField } from './deferral-reasons-field'
import { DockLoadersSection } from './dock-loaders-section'
import { DockTabletsSection } from './dock-tablets-section'
import { SettingRow } from './setting-row'
import { TimeTravelSection } from './time-travel-section'

type Kind = 'time' | 'number' | 'switch'

interface SettingRowSpec {
  key: string
  title: string
  description: string
  kind: Kind
  /** Shown before or after a number: "LKR", "minutes". */
  prefix?: string
  suffix?: string
  width?: string
}

interface Section {
  id: string
  title: string
  description: string
  rows: SettingRowSpec[]
  extra?: 'reasons' | 'loaders' | 'dock' | 'demo'
}

/** A6's sections. Copy from the frame where it draws the row; the rest follows its voice. */
const SECTIONS: Section[] = [
  {
    id: 'ordering',
    title: 'Ordering',
    description: 'Applies to every outlet unless a depot overrides it.',
    rows: [
      { key: 'ordering.cutoffMin', title: 'Order cutoff', description: 'Orders sent after this go to the following run.', kind: 'time' },
      { key: 'ordering.cutoffReminderMin', title: 'Cutoff reminder', description: 'Outlets with no order yet get a reminder at this time.', kind: 'time' },
      { key: 'planning.techValueLimitLkr', title: 'Tech high-value limit', description: 'Orders above this need a single-item order.', kind: 'number', prefix: 'LKR', width: 'w-40' },
    ],
  },
  {
    id: 'planning',
    title: 'Planning',
    description: 'How the engine builds trips.',
    rows: [
      { key: 'planning.reeferCarriesAmbient', title: 'Reefers carry ambient', description: 'A refrigerated truck may also take dry orders.', kind: 'switch' },
      { key: 'planning.freshStartMin', title: 'Fresh start', description: 'Earliest departure for Fresh trips.', kind: 'time' },
      { key: 'planning.reloadMinutes', title: 'Reload gap', description: "Time between a vehicle's two trips.", kind: 'number', suffix: 'min' },
    ],
  },
  {
    id: 'deferrals',
    title: 'Deferrals',
    description: 'Reasons dispatchers can pick, and the repeat-skip rule.',
    extra: 'reasons',
    rows: [
      { key: 'planning.repeatSkipLookbackRuns', title: 'Repeat-skip warning', description: 'Warn when the same outlet was deferred within this many runs.', kind: 'number', suffix: 'runs' },
      { key: 'store.mustAcknowledgeDeferral', title: 'Store must acknowledge', description: 'Deferrals stay open until the store responds.', kind: 'switch' },
    ],
  },
  { id: 'dock-loaders', title: 'Dock loaders', description: 'Who shares each depot’s dock tablet. Loaders pick their name from this list when they check items.', rows: [], extra: 'loaders' },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'When stores and dispatchers hear about delays.',
    rows: [
      { key: 'tracking.etaSlipNotifyMinutes', title: 'ETA slip notice', description: 'Tell the store when its ETA moves by this much.', kind: 'number', suffix: 'min' },
      { key: 'tracking.offlineAlertMinutes', title: 'Vehicle offline alert', description: 'Alert dispatchers when a vehicle sends no position for this long.', kind: 'number', suffix: 'min' },
      { key: 'tracking.lateRiskThreshold', title: 'Late-risk alert', description: 'Alert when a stop is at least this likely to be late (0 to 1).', kind: 'number' },
      { key: 'loading.maxReleaseTempC', title: 'Release temperature', description: 'Warmest a reefer may be when a chilled trip leaves.', kind: 'number', suffix: '°C' },
    ],
  },
  { id: 'security', title: 'Security', description: 'Which tablets loaders can sign in on with a PIN.', rows: [], extra: 'dock' },
]

const DEMO_SECTION: Section = { id: 'demo', title: 'Demo', description: 'Time travel, a clean demo day and the simulator. Demo mode only.', rows: [], extra: 'demo' }

const pad = (n: number) => String(n).padStart(2, '0')
const toDraft = (kind: Kind, value: unknown): string => {
  if (kind === 'time' && typeof value === 'number') return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`
  // 250000 reads as 250,000, as A6 shows the Tech limit; fromDraft drops the commas again.
  if (kind === 'number' && typeof value === 'number') return Math.abs(value) >= 10_000 ? value.toLocaleString('en-US') : String(value)
  return String(value)
}
const fromDraft = (kind: Kind, draft: string): number | string | boolean => {
  if (kind === 'switch') return draft === 'true'
  if (kind === 'time') {
    const match = /^(\d{1,2}):(\d{2})$/.exec(draft.trim())
    return match ? Number(match[1]) * 60 + Number(match[2]) : draft
  }
  const n = Number(draft.replace(/,/g, '').trim())
  return draft.trim() === '' || Number.isNaN(n) ? draft : n
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const settings = useSettingsList()
  const clock = useClockGet()
  const save = useSettingsSet()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [active, setActive] = useState('ordering')
  const [saving, setSaving] = useState(false)

  const byKey = new Map((settings.data?.data ?? []).map((s) => [s.key, s]))
  const sections = clock.data?.data.demoMode ? [...SECTIONS, DEMO_SECTION] : SECTIONS
  const kindOf = new Map(SECTIONS.flatMap((s) => s.rows.map((r) => [r.key, r.kind] as const)))
  const changed = Object.entries(drafts).filter(([key, draft]) => {
    const setting = byKey.get(key)
    const kind = kindOf.get(key)
    return setting && kind && toDraft(kind, setting.value) !== draft
  })
  const canSave = (settings.data?.data ?? []).some((s) => getLink(s._links, 'edit'))

  const sectionIds = sections.map((s) => s.id).join(',')
  useEffect(() => {
    const ids = sectionIds.split(',')
    /** The last section whose heading has passed the top of the view: the one being read. */
    const pick = () => {
      const current = ids.filter((id) => {
        const top = document.getElementById(id)?.getBoundingClientRect().top
        return top !== undefined && top <= 120
      })
      setActive(current.at(-1) ?? ids[0])
    }
    const observer = new IntersectionObserver(pick, { threshold: [0, 1] })
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [sectionIds])

  const saveAll = async () => {
    setSaving(true)
    // One request per changed key, all at once: a serial loop makes saving N settings N times slower.
    const results = await Promise.all(
      changed.map(async ([key, draft]) => {
        try {
          await save.mutateAsync({ key, data: { value: fromDraft(kindOf.get(key) ?? 'number', draft) } })
          return [key, null] as const
        } catch (error) {
          const message = isApiProblem(error)
            ? (error.errors[0]?.message ?? error.detail ?? error.title)
            : 'Not saved. Try again.'
          return [key, message] as const
        }
      }),
    )
    const errors = Object.fromEntries(results.filter((r): r is readonly [string, string] => r[1] !== null))
    setRowErrors(errors)
    await queryClient.invalidateQueries({ queryKey: getSettingsListQueryKey() })
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key in errors)))
    setSaving(false)
    const saved = changed.length - Object.keys(errors).length
    if (saved > 0) toast({ title: saved === 1 ? 'Setting saved' : `${saved} settings saved`, description: 'Every screen picks it up at once.', tone: 'success' })
  }

  return (
    <>
      {canSave ? (
        <HeaderActions>
          <Button variant="primary" loading={saving} disabled={changed.length === 0} onClick={() => void saveAll()}>
            Save changes
          </Button>
        </HeaderActions>
      ) : null}

      <div className="flex gap-8">
        <nav aria-label="Settings sections" className="sticky top-4 flex w-[200px] shrink-0 flex-col gap-0.5 self-start pt-2">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={active === s.id ? 'true' : undefined}
              onClick={() => {
                setActive(s.id)
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className={cn(
                'cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-2 text-left font-sans text-[14px] font-medium leading-auto text-foreground transition-colors',
                active === s.id ? 'bg-secondary font-bold' : 'hover:bg-slate-100',
              )}
            >
              {s.title}
            </button>
          ))}
        </nav>

        <div className="flex w-full max-w-[880px] flex-col">
          {settings.error ? (
            <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
          ) : (
            sections.map((section, index) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-4">
                <div className={cn('flex flex-col gap-0.5 pb-1', index === 0 ? 'pt-2' : 'pt-6')}>
                  <h2 id={`${section.id}-title`} className="type-title m-0 text-foreground">
                    {section.title}
                  </h2>
                  <p className="type-body m-0 text-muted-foreground">{section.description}</p>
                </div>
                {section.extra === 'reasons' ? (
                  <SettingRow title="Reasons" description="Shown to the store with every deferral.">
                    <DeferralReasonsField />
                  </SettingRow>
                ) : null}
                {section.rows.map((row) => {
                  const setting = byKey.get(row.key)
                  return (
                    <SettingRow key={row.key} title={row.title} description={row.description} error={rowErrors[row.key]}>
                      {settings.isPending || !setting ? (
                        <Skeleton className="h-9 w-[120px]" />
                      ) : (
                        <SettingControl
                          spec={row}
                          setting={setting}
                          draft={drafts[row.key] ?? toDraft(row.kind, setting.value)}
                          onDraft={(value) => setDrafts((d) => ({ ...d, [row.key]: value }))}
                        />
                      )}
                    </SettingRow>
                  )
                })}
                {section.extra === 'loaders' ? <DockLoadersSection /> : null}
                {section.extra === 'dock' ? <DockTabletsSection /> : null}
                {section.extra === 'demo' && clock.data ? (
                  <>
                    <TimeTravelSection clock={clock.data.data} />
                    <SimulationSection clock={clock.data.data} />
                  </>
                ) : null}
              </section>
            ))
          )}
        </div>
      </div>
    </>
  )
}

function SettingControl({ spec, setting, draft, onDraft }: { spec: SettingRowSpec; setting: SettingDto; draft: string; onDraft: (v: string) => void }) {
  const editable = Boolean(getLink(setting._links, 'edit'))
  if (spec.kind === 'switch') {
    return (
      <Switch
        aria-label={spec.title}
        checked={draft === 'true'}
        disabled={!editable}
        onCheckedChange={(checked) => onDraft(String(checked))}
      />
    )
  }
  return (
    <div className={cn('flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3.5', spec.width ?? 'w-[120px]', !editable && 'opacity-60')}>
      {spec.prefix ? <span className="font-sans text-[14px] text-foreground">{spec.prefix}</span> : null}
      <Input
        aria-label={spec.title}
        value={draft}
        disabled={!editable}
        inputMode={spec.kind === 'time' ? 'numeric' : 'decimal'}
        placeholder={spec.kind === 'time' ? 'HH:MM' : undefined}
        onChange={(e) => onDraft(e.target.value)}
        className={cn('h-auto min-w-0 flex-1 border-0 p-0 shadow-none focus-visible:ring-0', spec.kind === 'time' && 'font-mono')}
      />
      {spec.suffix ? <span className="font-sans text-[14px] text-muted-foreground">{spec.suffix}</span> : null}
    </div>
  )
}
