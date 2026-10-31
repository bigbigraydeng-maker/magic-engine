'use client'

/**
 * CRM workspace shell: top nav bar + collapsible sidebar state.
 *
 * The big ME sidebar is rendered by the parent dashboard shell. This component
 * hides it (by injecting a style that targets the shell's `data-me-shell` /
 * `data-me-sidebar` hooks) only while a CRM page is mounted, so every other
 * dashboard page is untouched. It owns the collapsed flag, the toggle button
 * and the top navigation bar.
 *
 * Collapsed is the default so the server render and the first client paint
 * agree; the persisted preference is applied in an effect after mount.
 */

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { afterCrmListReady } from '@/lib/crm/list-ready'
import {
  activeCrmNavKey,
  buildCrmNavItems,
  isSamePagePath,
  readSidebarCollapsed,
  writeSidebarCollapsed,
  type StorageLike,
} from '@/lib/crm/workspace-shell'

const PROBE_TTL_MS = 5 * 60 * 1000
const probeCache = new Map<string, { ok: boolean; at: number }>()

/** Test hook: forget every cached bookings-access answer. */
export function resetCrmShellProbeCache(): void {
  probeCache.clear()
}

/** The cached probe answer for this client, or null when absent or stale. */
function readProbeCache(clientId: string): boolean | null {
  const hit = probeCache.get(clientId)
  if (hit === undefined || Date.now() - hit.at > PROBE_TTL_MS) return null
  return hit.ok
}

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

const COLLAPSED_STYLE =
  '[data-me-shell]{grid-template-columns:minmax(0,1fr) !important}[data-me-sidebar]{display:none !important}'

export function CrmWorkspaceShell({
  clientId,
  children,
}: {
  clientId: string
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(true)

  useEffect(() => {
    setCollapsed(readSidebarCollapsed(safeStorage()))
  }, [])

  const [allowed, setAllowed] = useState(() => readProbeCache(clientId) === true)

  useEffect(() => {
    const cached = readProbeCache(clientId)
    if (cached !== null) {
      setAllowed(cached)
      return
    }
    let cancelled = false
    const cancelWait = afterCrmListReady(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/clients/${clientId}/crm/bookings/access`)
          if (res.status === 200 || res.status === 403 || res.status === 404) {
            probeCache.set(clientId, { ok: res.status === 200, at: Date.now() })
          }
          if (!cancelled) setAllowed(res.status === 200)
        } catch {
          // Network error: stay hidden and do not cache, so the next visit retries.
        }
      })()
    })
    return () => {
      cancelled = true
      cancelWait()
    }
  }, [clientId])

  const onToggle = () => {
    const next = !collapsed
    setCollapsed(next)
    writeSidebarCollapsed(next, safeStorage())
  }

  return (
    <>
      {collapsed && <style dangerouslySetInnerHTML={{ __html: COLLAPSED_STYLE }} />}
      <div className="border-b border-me-charcoal/10 bg-[#FBF8F3]">
        <Suspense fallback={null}>
          <CrmTopNav
            clientId={clientId}
            collapsed={collapsed}
            onToggle={onToggle}
            allowed={allowed}
          />
        </Suspense>
      </div>
      {children}
    </>
  )
}

function CrmTopNav({
  clientId,
  collapsed,
  onToggle,
  allowed,
}: {
  clientId: string
  collapsed: boolean
  onToggle: () => void
  allowed: boolean
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeKey = activeCrmNavKey(pathname, searchParams.toString(), clientId)
  const items = buildCrmNavItems(clientId)

  return (
    <nav
      aria-label="客户跟进导航"
      className="flex flex-wrap items-center gap-x-1 gap-y-1 px-4 py-2 text-sm"
    >
      <Link
        href="/dashboard"
        className="rounded-md px-3 py-1.5 font-bold text-me-charcoal/70 hover:text-me-charcoal"
      >
        回 ME 主菜单
      </Link>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={!collapsed}
        className="hidden rounded-md border border-me-charcoal/15 px-3 py-1.5 text-xs font-semibold text-me-charcoal/60 hover:text-me-charcoal md:inline-flex"
      >
        {collapsed ? '展开左侧菜单' : '收起左侧菜单'}
      </button>
      <span aria-hidden className="mx-2 hidden h-5 w-px bg-me-charcoal/15 md:inline-block" />
      {items.map((item) => {
        if (item.needsBookingsAccess && !allowed) return null


        if (item.href === null) {
          return (
            <span
              key={item.key}
              aria-disabled="true"
              title={item.title}
              className="cursor-default rounded-md border border-dashed border-me-charcoal/30 px-3 py-1.5 font-bold text-me-charcoal/40"
            >
              {item.label}
            </span>
          )
        }

        const active = item.key === activeKey
        const className =
          'rounded-md px-3 py-1.5 font-bold transition ' +
          (active ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60 hover:text-me-charcoal')
        const ariaCurrent = active ? 'page' : undefined

        // Deliberate full page load: the customer list page reads ?view= only
        // when it first mounts, so a client-side navigation between "today"
        // and "all" would not switch the view.
        if (isSamePagePath(pathname, item.href)) {
          return (
            <a
              key={item.key}
              href={item.href}
              title={item.title}
              aria-current={ariaCurrent}
              className={className}
            >
              {item.label}
            </a>
          )
        }

        return (
          <Link
            key={item.key}
            href={item.href}
            title={item.title}
            aria-current={ariaCurrent}
            className={className}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
