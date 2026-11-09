'use client'

/**
 * CRM workspace shell: top nav bar + collapsible sidebar state.
 *
 * The big ME sidebar is rendered by the parent dashboard shell. This component
 * hides it (via a style that targets the shell's `data-me-shell` /
 * `data-me-sidebar` hooks, keyed off the `data-crm-sidebar` attribute on our
 * wrapper) only while a CRM page is mounted, so every other dashboard page is
 * untouched. It owns the collapsed flag, the toggle button and the top nav bar.
 *
 * Collapsed is the default so the server render and the first client paint
 * agree. The persisted preference is applied before paint by a layout effect,
 * and an inline script handles the very first page load so people who chose
 * "expanded" never see the sidebar flash closed.
 *
 * All access probing (bookings / templates) lives in `./useCrmNavAccess`; this
 * component never fetches anything itself.
 */

import { Suspense, useEffect, useLayoutEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  activeCrmNavKey,
  buildCrmNavItems,
  isSamePagePath,
  readSidebarCollapsed,
  writeSidebarCollapsed,
  CRM_SIDEBAR_STORAGE_KEY,
  type CrmNavItem,
  type StorageLike,
} from '@/lib/crm/workspace-shell'
import { useBookingsAccess, useTemplatesAccess } from './useCrmNavAccess'

/**
 * Accessing window.localStorage can itself throw (blocked storage, sandboxed
 * iframes), so the access is guarded and null is passed through on failure.
 */
function safeStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Always rendered. `:has()` lets the CSS react to the `data-crm-sidebar`
 * attribute on our wrapper without any JS toggling of the style element.
 */
const SHELL_CSS =
  '[data-me-shell]:has([data-crm-sidebar="closed"]){grid-template-columns:minmax(0,1fr) !important}[data-me-shell]:has([data-crm-sidebar="closed"]) [data-me-sidebar]{display:none !important}'

/**
 * Runs while the HTML is parsed, before the page is painted, so people who
 * chose "expanded" do not see the sidebar flash closed on first load. On
 * client-side navigation inline scripts do not run, so the layout effect in
 * the component covers that case.
 */
const INIT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  CRM_SIDEBAR_STORAGE_KEY,
)})==='0'){var s=document.currentScript;if(s&&s.parentElement){s.parentElement.setAttribute('data-crm-sidebar','open')}}}catch(e){}`

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-me-charcoal/40'

const TOGGLE_CLS =
  'hidden items-center gap-2 rounded-md border border-me-charcoal/25 px-3 py-2.5 text-sm font-semibold text-me-charcoal/70 hover:text-me-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-me-charcoal/40 md:inline-flex'

/** useLayoutEffect on the client, useEffect on the server (avoids the SSR warning). */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function CrmWorkspaceShell({
  clientId,
  children,
}: {
  clientId: string
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(true)

  useIsoLayoutEffect(() => {
    setCollapsed(readSidebarCollapsed(safeStorage()))
  }, [])

  const bookingsAllowed = useBookingsAccess(clientId)
  const templatesAllowed = useTemplatesAccess(clientId)

  const onToggle = () => {
    const next = !collapsed
    setCollapsed(next)
    writeSidebarCollapsed(next, safeStorage())
  }

  return (
    <div data-crm-sidebar={collapsed ? 'closed' : 'open'} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />
      <style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />
      <div className="z-30 border-b border-me-charcoal/10 bg-[#FBF8F3] md:sticky md:top-0">
        <Suspense fallback={null}>
          <CrmTopNav
            clientId={clientId}
            collapsed={collapsed}
            onToggle={onToggle}
            bookingsAllowed={bookingsAllowed}
            templatesAllowed={templatesAllowed}
          />
        </Suspense>
      </div>
      {children}
    </div>
  )
}

function isVisible(
  item: CrmNavItem,
  bookingsAllowed: boolean,
  templatesAllowed: boolean,
): boolean {
  if (item.gate === 'bookings') return bookingsAllowed
  if (item.gate === 'templates') return templatesAllowed
  return true
}

function NavItemLink({
  item,
  active,
  pathname,
}: {
  item: CrmNavItem
  active: boolean
  pathname: string
}) {
  const className =
    `${FOCUS} rounded-md px-4 py-2.5 text-base font-bold transition ` +
    (active ? 'bg-me-charcoal text-white' : 'text-me-charcoal/70 hover:text-me-charcoal')
  const ariaCurrent = active ? 'page' : undefined

  // Deliberate full page load: the customer list page reads ?view= only when
  // it first mounts, so a client-side navigation between "today" and "all"
  // would not switch the view.
  if (isSamePagePath(pathname, item.href)) {
    return (
      <a href={item.href} title={item.title} aria-current={ariaCurrent} className={className}>
        {item.label}
      </a>
    )
  }

  return (
    <Link href={item.href} title={item.title} aria-current={ariaCurrent} className={className}>
      {item.label}
    </Link>
  )
}

function CrmTopNav({
  clientId,
  collapsed,
  onToggle,
  bookingsAllowed,
  templatesAllowed,
}: {
  clientId: string
  collapsed: boolean
  onToggle: () => void
  bookingsAllowed: boolean
  templatesAllowed: boolean
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeKey = activeCrmNavKey(pathname, searchParams.toString(), clientId)
  const items = buildCrmNavItems(clientId).filter((item) =>
    isVisible(item, bookingsAllowed, templatesAllowed),
  )
  const leftItems = items.filter((item) => item.align === 'left')
  const rightItems = items.filter((item) => item.align === 'right')

  return (
    <nav
      aria-label="客户跟进导航"
      className="flex min-h-[48px] flex-wrap items-center gap-x-1 gap-y-1 px-4 py-1"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title="展开或收起左边的大菜单"
        className={TOGGLE_CLS}
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="3" y1="6" x2="17" y2="6" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="14" x2="17" y2="14" />
        </svg>
        菜单
      </button>
      <Link
        href="/dashboard"
        className={`${FOCUS} rounded-md px-4 py-2.5 text-base font-medium text-me-charcoal/70 hover:text-me-charcoal hover:underline`}
      >
        回 ME 主菜单
      </Link>
      <span aria-hidden className="mx-2 hidden h-6 w-px bg-me-charcoal/20 md:inline-block" />
      {leftItems.map((item) => (
        <NavItemLink
          key={item.key}
          item={item}
          active={item.key === activeKey}
          pathname={pathname}
        />
      ))}
      <div className="ml-auto flex flex-wrap items-center gap-1">
        {rightItems.map((item) => (
          <NavItemLink
            key={item.key}
            item={item}
            active={item.key === activeKey}
            pathname={pathname}
          />
        ))}
      </div>
    </nav>
  )
}
