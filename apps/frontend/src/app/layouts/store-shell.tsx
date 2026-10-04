// Figma: M1 New order · 185:10376 (the store chrome: sidebar, account card and header)
import { useMeGet, useOutletsGet } from '@compass/api-client'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShellNavItem } from './desktop-shell'
import { DesktopShell } from './desktop-shell'

/**
 * The store manager's shell (M1 to M9). The outlet is named wherever she looks, as the frames do
 * ("STORE · FRESH KADAWATHA" over the nav, "ORDERS · FRESH KADAWATHA" over each page title), so
 * someone covering two outlets never wonders which one an order is for.
 */
export function StoreShell() {
  const { t } = useTranslation()
  const outletId = useMeGet().data?.data.outletId ?? ''
  const outlet = useOutletsGet(outletId, { query: { enabled: outletId !== '' } }).data?.data
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

  return (
    <DesktopShell
      navLabel={outlet ? `${t('nav.store')} · ${outlet.name.toUpperCase()}` : t('nav.store')}
      nav={nav}
      eyebrow="Store"
      title={t('nav.orders')}
      place={outlet?.name}
    />
  )
}
