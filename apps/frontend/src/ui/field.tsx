import { Label as LabelPrimitive } from 'radix-ui'
import { useId, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Figma field label: Compass/Label in capitals, muted ("FULL NAME" in A2). */
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root data-slot="label" className={cn('type-label uppercase text-muted-foreground', className)} {...props} />
}

export interface FieldProps {
  label: ReactNode
  /** Helper text under the control ("Scopes what this person can see."). */
  hint?: ReactNode
  /** Error message; replaces the hint and marks the control invalid. */
  error?: ReactNode
  /** Render-prop so the control gets the ids that tie it to the label, hint and error. */
  children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactElement
  className?: string
}

/** Label, control and hint or error, stacked with a 6 px gap (Figma "Field / Full name"). */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const message = error ?? hint
  return (
    <div data-slot="field" className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-describedby': message ? messageId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {message ? (
        <p id={messageId} className={cn('type-caption m-0 leading-[17.4px]', error ? 'text-destructive-foreground' : 'text-muted-foreground')}>
          {message}
        </p>
      ) : null}
    </div>
  )
}
