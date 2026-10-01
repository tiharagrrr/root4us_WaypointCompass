// Figma: M1 New order · 185:10376 (the store chrome: sidebar, account card and header)
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShellNavItem } from './desktop-shell'
import { DesktopShell } from './desktop-shell'

/**
 * The store manager's shell (M1 to M9). The frame names the outlet in the sidebar label and the
 * header eyebrow ("STORE · FRESH KADAWATHA"); /me carries only outletId, so the name follows when
 * master data publishes GET /outlets (specs/frontend/screens.md, Open questions).
 */
export function StoreShell() {
  const { t } = useTranslation()
  const nav = useMemo<ShellNavItem[]>(
    () => [
      { to: '/store/orders/new', label: t('nav.newOrder'), icon: 'new-order' },
      { to: '/store/orders', label: t('nav.orders'), icon: 'orders' },
      { to: '/store/deferrals', label: t('nav.deferrals'), icon: 'deferrals', deep: true },
      { to: '/store/receipts', label: t('nav.receipts'), icon: 'receipts', deep: true },
      { to: '/store/catalog', label: t('nav.itemCatalog'), icon: 'item-catalog' },
    ],
    [t],
  )

  return <DesktopShell navLabel={t('nav.store')} nav={nav} eyebrow="Store · Waypoint Lanka" title={t('nav.orders')} />
}
