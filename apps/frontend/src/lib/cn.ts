import { textStyles } from '@compass/ui-tokens'
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge<'compass-type'>({
  extend: {
    // .type-* text styles from @compass/ui-tokens replace each other, like text sizes do.
    classGroups: { 'compass-type': [{ type: Object.keys(textStyles) }] },
  },
})

/** shadcn's class helper: clsx, then tailwind-merge aware of the Compass text styles. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
