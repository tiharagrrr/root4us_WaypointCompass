import { initials } from '@/lib/roles'
import { cn } from '@/lib/cn'

export interface AvatarProps {
  /** The person's full name; the circle shows their initials ("Harini De Mel" → HD). */
  name: string
  /** px; 32 in the desktop account card (A1), 36 on the dock and driver top bars. */
  size?: number
  className?: string
}

/** Figma: the initials circle in the sidebar account card (A1), the dock top bar (L2) and D1. */
export function Avatar({ name, size = 32, className }: AvatarProps) {
  return (
    <span
      data-slot="avatar"
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-accent font-sans text-[12px] font-bold text-primary', className)}
    >
      {initials(name)}
    </span>
  )
}
