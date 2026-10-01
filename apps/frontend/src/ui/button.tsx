import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

// Figma: Button · 80:9704. One primary per view; Default (black) for most actions; outline for
// secondary; destructive is a soft two-tone red. Hover and pressed colours follow the Figma states.
const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border transition-colors duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-40 aria-busy:opacity-60',
  {
    variants: {
      variant: {
        primary: 'border-blue-700 bg-primary text-primary-foreground hover:border-blue-800 hover:bg-blue-800 active:border-blue-900 active:bg-blue-900',
        default: 'border-ink bg-default text-default-foreground hover:border-slate-800 hover:bg-slate-800 active:border-slate-700 active:bg-slate-700',
        secondary: 'border-slate-100 bg-secondary text-secondary-foreground hover:border-slate-200 hover:bg-slate-200 active:border-slate-300 active:bg-slate-300',
        outline: 'border-slate-300 bg-background text-foreground hover:bg-slate-100 active:border-slate-400 active:bg-slate-200',
        ghost: 'border-transparent bg-transparent text-foreground hover:bg-slate-100 active:bg-slate-200',
        destructive: 'border-red-100 bg-destructive text-destructive-foreground hover:border-red-200 hover:bg-red-200 active:border-red-200 active:bg-red-600',
        link: 'border-transparent bg-transparent text-primary hover:underline active:text-blue-800',
      },
      size: {
        default: 'type-body-medium h-9 px-[15px]',
        sm: 'type-field-label h-8 px-[13px]',
        lg: 'type-body-medium h-11 px-[21px] text-[15px]',
        icon: 'size-9 p-0',
        'icon-sm': 'size-8 p-0',
        touch: 'type-body-medium h-12 rounded-lg px-1.5 text-[15px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Render the child element (a router Link, say) with button styles. */
  asChild?: boolean
  /** The Figma Loading state: dimmed, busy and not clickable. */
  loading?: boolean
}

export function Button({ className, variant, size, asChild = false, loading = false, disabled, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? 'default'}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    />
  )
}
