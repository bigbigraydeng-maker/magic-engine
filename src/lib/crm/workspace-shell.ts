/**
 * Pure helpers for the CRM workspace shell (sidebar collapse preference + top nav items and active state).
 *
 * No React, no imports — everything here is trivially unit-testable and safe
 * to call from server or client code.
 */

export const CRM_SIDEBAR_STORAGE_KEY = 'me.crm.sidebarCollapsed'

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type CrmNavKey = 'today' | 'all' | 'payments' | 'sales' | 'calendar' | 'templates' | 'settings'

/** Who may see an item: everyone, only people passing the bookings-access probe, or only people who see the email-template page today. */
export type CrmNavGate = 'none' | 'bookings' | 'templates'

export type CrmNavItem = {
  key: CrmNavKey
  /** Chinese label shown in the top nav. */
  label: string
  href: string
  /** Short Chinese tooltip. */
  title: string
  gate: CrmNavGate
  /** Which side of the bar the item sits on. */
  align: 'left' | 'right'
}

/**
 * Read the persisted sidebar state.
 *
 * Defaults to collapsed (true). Only the literal '0' means expanded; anything
 * else — missing key, garbage, null storage, or a throwing storage — is treated
 * as collapsed so a broken localStorage never leaves the sidebar in a weird state.
 */
export function readSidebarCollapsed(storage: StorageLike | null | undefined): boolean {
  if (!storage) return true
  try {
    return storage.getItem(CRM_SIDEBAR_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Persist the sidebar state. Never throws — storage failures are swallowed
 * because losing a UI preference is not worth breaking the page.
 */
export function writeSidebarCollapsed(
  collapsed: boolean,
  storage: StorageLike | null | undefined,
): void {
  if (!storage) return
  try {
    storage.setItem(CRM_SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    // Ignore: quota errors / private-mode storage are not actionable here.
  }
}

/** Build the top nav items for a given client: left group first, then the right-aligned group. */
export function buildCrmNavItems(clientId: string): CrmNavItem[] {
  const base = `/dashboard/clients/${clientId}`
  return [
    { key: 'today', label: '今天先联系', href: `${base}/crm/all?view=smart`, title: '系统排好的：今天先联系谁', gate: 'none', align: 'left' },
    { key: 'all', label: '全部客人', href: `${base}/crm/all?view=all`, title: '翻看、搜索这个客户的所有客人', gate: 'none', align: 'left' },
    { key: 'payments', label: '付款总览', href: `${base}/crm/payments`, title: '按出发日期看每个团收了多少定金尾款、谁还没收齐、哪些已过期', gate: 'bookings', align: 'left' },
    { key: 'sales', label: '销售进度', href: `${base}/sales-progress`, title: '每个团卖了多少、还差多少人成行', gate: 'bookings', align: 'left' },
    { key: 'calendar', label: '到期日历', href: `${base}/crm/calendar`, title: '定金尾款到期日历', gate: 'bookings', align: 'left' },
    { key: 'templates', label: '邮件模板', href: `${base}/crm/templates`, title: '通话后发跟进邮件用的模板：看模板、改模板、看最近发了什么', gate: 'templates', align: 'right' },
    { key: 'settings', label: '设置', href: `${base}/settings?tab=crm`, title: 'CRM 设置', gate: 'none', align: 'right' },
  ]
}

/**
 * Which top nav item should be highlighted for the current URL.
 *
 * `search` may be a raw query string with or without a leading '?'.
 * Returns null when the path is not part of the CRM workspace.
 */
export function activeCrmNavKey(
  pathname: string,
  search: string,
  clientId: string,
): CrmNavKey | null {
  const base = `/dashboard/clients/${clientId}`

  if (pathname === `${base}/crm/all`) {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    const view = params.get('view')
    // Smart view always wins, even if a filter param is also present.
    if (view === 'smart') return 'today'
    if (view === 'all' || params.has('contact') || params.has('assignee')) return 'all'
    return 'today'
  }

  if (pathname === `${base}/crm/calendar`) return 'calendar'
  if (pathname === `${base}/crm/payments`) return 'payments'
  if (pathname === `${base}/crm/templates`) return 'templates'

  if (pathname === `${base}/sales-progress` || pathname.startsWith(`${base}/sales-progress/`)) {
    return 'sales'
  }

  if (pathname === `${base}/settings`) return 'settings'

  return null
}

/** True when the href points at exactly the given pathname (query ignored). */
export function isSamePagePath(pathname: string, href: string): boolean {
  const qIndex = href.indexOf('?')
  const hrefPath = qIndex === -1 ? href : href.slice(0, qIndex)
  return hrefPath === pathname
}
