import { cn } from '@/lib/cn'
import needle from './icons/compass-needle.svg'

// Figma: "Logo / Lockup" (423:1867): "waypoint" in Inter Extra Bold with the compass needle for the
// "o", over COMPASS in Google Sans Code. `lg` is the A0 sign-in lockup (423:1860), 1.6 times larger.
const SIZES = {
  sm: {
    gap: 'gap-0.5',
    word: 'text-[20px] leading-5 tracking-[-0.9px]',
    way: 'pr-[0.8px]',
    needle: 12,
    needleGap: 'ml-[0.9px] mr-[0.49px] size-3',
    descriptor: 'pl-0.5 text-[8.4px] tracking-[8.55px]',
  },
  lg: {
    gap: 'gap-[3px]',
    word: 'text-[32px] leading-8 tracking-[-1.44px]',
    way: 'pr-[1.28px]',
    needle: 19,
    needleGap: 'ml-[1.44px] mr-[0.99px] size-[19px]',
    descriptor: 'pl-[3.2px] text-[13.4px] tracking-[13.745px]',
  },
} as const

export function Wordmark({ className, size = 'sm' }: { className?: string; size?: keyof typeof SIZES }) {
  const s = SIZES[size]
  return (
    <div role="img" aria-label="Waypoint Compass" className={cn('flex flex-col overflow-clip', s.gap, className)}>
      <div aria-hidden="true" className={cn('flex items-baseline font-brand font-extrabold', s.word)}>
        <span className={cn('italic text-primary', s.way)}>way</span>
        <span className="text-foreground">p</span>
        <img src={needle} alt="" width={s.needle} height={s.needle} className={s.needleGap} />
        <span className="text-foreground">int</span>
      </div>
      <span aria-hidden="true" className={cn('font-mono font-medium leading-auto text-primary', s.descriptor)}>
        COMPASS
      </span>
    </div>
  )
}
