import type { LinkDto } from '@compass/api-client'

/** A hypermedia link from a resource's _links (specs/api-conventions.md, section 2). */
export type Link = LinkDto

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** True when the value is a usable link: an object with a string href. */
export const isLink = (value: unknown): value is Link =>
  isRecord(value) && typeof value.href === 'string' && value.href !== ''

/** The link for a relation, or undefined when the resource does not offer it. */
export const getLink = (links: unknown, rel: string): Link | undefined => {
  if (!isRecord(links)) return undefined
  const link = links[rel]
  return isLink(link) ? link : undefined
}

/** Whether the action needs a header or body field, e.g. requires(link, 'If-Match'). */
export const requires = (link: Link, what: string): boolean => link.requires?.includes(what) ?? false
