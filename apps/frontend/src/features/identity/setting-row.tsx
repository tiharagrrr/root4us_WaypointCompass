// Figma: A6 Settings · 185:10227 ("List item / Order cutoff")
import type { ReactNode } from 'react'

/** One A6 list item: title and description on the left, the control on the right. */
export function SettingRow({ title, description, error, children }: { title: string; description: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div data-slot="setting-row" className="flex items-center gap-6 border-t border-border py-[18px]">
      <div className="flex w-[536px] shrink-0 flex-col gap-0.5">
        <h3 className="m-0 font-sans text-[15px] font-bold leading-[21px] text-foreground">{title}</h3>
        <p className="type-body m-0 text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {children}
        {error ? (
          <p role="alert" className="type-caption m-0 text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
