import type { ItemDto, OrderDto, TempClass } from '@compass/api-client'
import { classLabelInline, clockLabel, dayLabel, kg, positionLabel, timeLabel } from './order-format'

/** The label of the one button that sends this order (M1, M1b and M2 each word it differently). */
export const sendLabel = (order: OrderDto): string =>
  order.afterCutoff
    ? `Send ${classLabelInline(order.tempClass)} for ${dayLabel(order.deliveryDate)}`
    : `Send ${classLabelInline(order.tempClass)}`

/**
 * The line under the button: what this press sends, where the day's other order stands, and the
 * cutoff while both are still open.
 */
export function sendHint(order: OrderDto, orders: readonly OrderDto[]): string {
  const other = orders.find((o) => o.id !== order.id)
  const sentences = [
    `Sends ${positionLabel(orders, order).toLowerCase()}${order.afterCutoff ? ' for the following run' : ''}.`,
  ]
  const otherSentAt = other && other.status !== 'DRAFT' ? other.submittedAt : null
  if (other && otherSentAt) {
    sentences.push(`The ${classLabelInline(other.tempClass)} went to the dispatcher at ${timeLabel(otherSentAt)}.`)
  } else if (other) {
    sentences.push(`The ${classLabelInline(other.tempClass)} stays open until you send it.`)
  }
  if (!otherSentAt && !order.afterCutoff) sentences.push(`Orders close at ${clockLabel(order.editableUntil)}.`)
  return sentences.join(' ')
}

/** "box" pluralises with -es; every other pack word takes an -s. */
const plural = (word: string): string => (word.endsWith('x') || word.endsWith('s') ? `${word}es` : `${word}s`)

/**
 * M1a's footer: "2 selected · 8 cases · 83 kg." The pack word follows the chosen items when they
 * agree, as in the frame, and falls back to "packs" for a mixed pick.
 */
export function pickedLine(chosen: readonly ItemDto[], picks: Record<string, number>): string {
  if (chosen.length === 0) return 'Nothing selected yet.'
  const packs = chosen.reduce((sum, item) => sum + (picks[item.id] ?? 0), 0)
  const weight = chosen.reduce((sum, item) => sum + (picks[item.id] ?? 0) * item.unitWeightKg, 0)
  const words = new Set(chosen.map((item) => item.packLabel.split(' ')[0]?.toLowerCase() ?? 'pack'))
  const [only] = [...words]
  const noun = words.size === 1 && only ? plural(only) : 'packs'
  return `${chosen.length} selected · ${packs} ${noun} · ${kg(weight)} kg.`
}

/** Where the other class is ordered: "Chilled items are added from the chilled order." */
export const otherClassSentence = (tempClass: TempClass): string => {
  const other: TempClass = tempClass === 'CHILLED' ? 'AMBIENT' : 'CHILLED'
  const word = other === 'CHILLED' ? 'Chilled' : 'Dry'
  return `${word} items are added from the ${classLabelInline(other)}.`
}

/** "Fresh" from FRESH, as M1a's "Waypoint Fresh range" reads. */
export const brandWord = (brand: string): string => brand.charAt(0) + brand.slice(1).toLowerCase()
