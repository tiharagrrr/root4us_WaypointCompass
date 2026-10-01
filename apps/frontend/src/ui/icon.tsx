import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import add from '@material-symbols/svg-400/rounded/add-fill.svg'
import assignmentTurnedIn from '@material-symbols/svg-400/rounded/assignment_turned_in-fill.svg'
import backspace from '@material-symbols/svg-400/rounded/backspace-fill.svg'
import calendarToday from '@material-symbols/svg-400/rounded/calendar_today-fill.svg'
import close from '@material-symbols/svg-400/rounded/close-fill.svg'
import dragIndicator from '@material-symbols/svg-400/rounded/drag_indicator-fill.svg'
import dashboard from '@material-symbols/svg-400/rounded/dashboard-fill.svg'
import eco from '@material-symbols/svg-400/rounded/eco-fill.svg'
import eventUpcoming from '@material-symbols/svg-400/rounded/event_upcoming-fill.svg'
import formatListBulleted from '@material-symbols/svg-400/rounded/format_list_bulleted-fill.svg'
import gridView from '@material-symbols/svg-400/rounded/grid_view-fill.svg'
import group from '@material-symbols/svg-400/rounded/group-fill.svg'
import history from '@material-symbols/svg-400/rounded/history-fill.svg'
import keyboardArrowDown from '@material-symbols/svg-400/rounded/keyboard_arrow_down-fill.svg'
import localShipping from '@material-symbols/svg-400/rounded/local_shipping-fill.svg'
import navigation from '@material-symbols/svg-400/rounded/navigation-fill.svg'
import notifications from '@material-symbols/svg-400/rounded/notifications-fill.svg'
import person from '@material-symbols/svg-400/rounded/person-fill.svg'
import route from '@material-symbols/svg-400/rounded/route-fill.svg'
import search from '@material-symbols/svg-400/rounded/search-fill.svg'
import settings from '@material-symbols/svg-400/rounded/settings-fill.svg'
import storefront from '@material-symbols/svg-400/rounded/storefront-fill.svg'
import warehouse from '@material-symbols/svg-400/rounded/warehouse-fill.svg'

/**
 * The Figma file draws its icons in Material Symbols (rounded, filled, weight 400), so the app
 * takes them from @material-symbols/svg-400 instead of keeping exported copies. The key is what
 * the icon means here; the value is the Material glyph the frames use.
 */
const icons = {
  account: person,
  backspace,
  bell: notifications,
  'chevron-down': keyboardArrowDown,
  'chevron-down-small': keyboardArrowDown,
  close,
  dashboard,
  deferrals: eventUpcoming,
  drag: dragIndicator,
  depots: warehouse,
  forecast: calendarToday,
  'item-catalog': gridView,
  leaf: eco,
  'new-order': add,
  orders: formatListBulleted,
  outlets: storefront,
  plan: route,
  receipts: assignmentTurnedIn,
  search,
  settings,
  today: localShipping,
  tracking: navigation,
  trips: history,
  users: group,
  vehicles: localShipping,
} as const

export type IconName = keyof typeof icons

export interface IconProps {
  name: IconName
  /** px; defaults to the SVG's own size in Figma (16). */
  size?: number
  className?: string
}

/**
 * A Material Symbols glyph drawn as a CSS mask, so it takes the text colour (currentColor) of its
 * parent: the same SVG serves the default and active tones.
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
