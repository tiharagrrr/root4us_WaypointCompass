import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import bell from './icons/bell.svg'
import chevronDown from './icons/chevron-down.svg'
import chevronDownSmall from './icons/chevron-down-small.svg'
import close from './icons/close.svg'
import deferrals from './icons/deferrals.svg'
import depots from './icons/depots.svg'
import itemCatalog from './icons/item-catalog.svg'
import newOrder from './icons/new-order.svg'
import orders from './icons/orders.svg'
import outlets from './icons/outlets.svg'
import plus from './icons/plus.svg'
import receipts from './icons/receipts.svg'
import search from './icons/search.svg'
import settings from './icons/settings.svg'
import users from './icons/users.svg'
import vehicles from './icons/vehicles.svg'

/**
 * The single-colour icons exported from the Figma file, unchanged. The library is Material
 * Symbols: take a new icon from the frame that needs it, or from Material Symbols Rounded at the
 * size the frame uses, and never redraw one by hand.
 */
const icons = {
  bell,
  'chevron-down': chevronDown,
  'chevron-down-small': chevronDownSmall,
  close,
  deferrals,
  depots,
  'item-catalog': itemCatalog,
  'new-order': newOrder,
  orders,
  outlets,
  plus,
  receipts,
  search,
  settings,
  users,
  vehicles,
} as const

export type IconName = keyof typeof icons

export interface IconProps {
  name: IconName
  /** px; defaults to the SVG's own size in Figma (16). */
  size?: number
  className?: string
}

/**
 * A Figma icon drawn as a CSS mask, so it takes the text colour (currentColor) of its parent:
 * the same SVG serves the default and active tones.
 */
export function Icon({ name, size = 16, className }: IconProps) {
  const url = `url("${icons[name]}")`
  const style: CSSProperties = {
    width: size,
    height: size,
    maskImage: url,
    WebkitMaskImage: url,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
  }
  return <span aria-hidden="true" data-icon={name} className={cn('inline-block shrink-0 bg-current', className)} style={style} />
}
