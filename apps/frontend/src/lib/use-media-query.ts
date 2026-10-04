import { useSyncExternalStore } from 'react'

/**
 * Whether a CSS media query matches, kept current as the viewport changes. Where matchMedia does
 * not exist (tests, old browsers) it answers `fallback`.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  return useSyncExternalStore(
    (notify) => {
      if (!supported) return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => (supported ? window.matchMedia(query).matches : fallback),
    () => fallback,
  )
}
