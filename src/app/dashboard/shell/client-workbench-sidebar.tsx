'use client'

import { useMemo } from 'react'
import { buildClientFdeSections } from './client-fde-nav'
import { LightNavLink } from './light-nav-link'
import { activeNavKey } from './nav-active'
import { ClientSwitcher } from './client-switcher'
import type { ViewerFacts } from '@/lib/auth/home-entries'
import type { ClientListRow } from './use-client-shell-data'

export function ClientWorkbenchSidebar({
  clientId,
  clientName,
  clients,
  industry,
  goalHref,
  facts,
  pathname,
}: {
  clientId: string
  clientName: string | null
  clients: ClientListRow[]
  industry: string | null
  goalHref: string
  facts: ViewerFacts
  pathname: string
}) {
  const sections = useMemo(
    () => buildClientFdeSections(clientId, industry, facts, goalHref),
    [clientId, industry, facts, goalHref],
  )
  const activeKey = activeNavKey(pathname, sections)

  return (
    <aside
      data-me-sidebar
      className="flex h-full w-[248px] shrink-0 flex-col border-r border-black/10 bg-me-ivory"
    >
      <div className="border-b border-black/8 px-3 py-3">
        <p className="mb-2 px-1 text-xs font-black uppercase tracking-[0.14em] text-me-charcoal/45">
          客户工作台
        </p>
        <ClientSwitcher
          clientId={clientId}
          clientName={clientName}
          clients={clients}
          pathname={pathname}
        />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section, i) => (
          <div key={i} className="mb-3">
            {section.title && (
              <p className="mb-1 px-2 text-[10px] font-black uppercase tracking-[.14em] text-me-charcoal/40">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <LightNavLink key={item.key} item={item} active={item.key === activeKey} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
