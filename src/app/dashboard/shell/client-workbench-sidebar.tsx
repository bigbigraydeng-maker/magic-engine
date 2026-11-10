'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { cx } from '@/components/ui/me-theme'
import { buildClientFdeSections } from './client-fde-nav'
import { activeNavKey, type NavItem } from './nav-active'
import { ClientSwitcher } from './client-switcher'
import type { ViewerFacts } from '@/lib/auth/home-entries'
import type { ClientListRow } from './use-client-shell-data'

function ClientNavLink({ item, active }: { item: NavItem; active: boolean }) {
  const cls = cx(
    'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition',
    active ? 'bg-me-ochre/14 text-me-charcoal' : 'text-me-charcoal/70 hover:bg-black/[.04] hover:text-me-charcoal',
  )
  const inner = (
    <>
      <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-black', active ? 'bg-me-ochre/20 text-me-ochre' : 'bg-me-stone/80 text-me-charcoal/45')}>
        {item.mark ?? item.label.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge === 'admin' && <span className="rounded bg-me-charcoal/8 px-1.5 py-0.5 text-[9px] font-bold text-me-charcoal/45">管理员</span>}
      {item.badge === 'fde' && <span className="rounded bg-me-charcoal/8 px-1.5 py-0.5 text-[9px] font-bold text-me-charcoal/45">FDE 可见</span>}
    </>
  )
  if (!item.href) return <div className={cls}>{inner}</div>
  return <Link href={item.href} className={cls}>{inner}</Link>
}

export function ClientWorkbenchSidebar({
  clientId, clientName, clients, industry, goalHref, facts, pathname,
}: {
  clientId: string
  clientName: string | null
  clients: ClientListRow[]
  industry: string | null
  goalHref: string
  facts: ViewerFacts
  pathname: string
}) {
  const sections = useMemo(() => buildClientFdeSections(clientId, industry, facts, goalHref), [clientId, industry, facts, goalHref])
  const activeKey = activeNavKey(pathname, sections)

  return (
    <aside data-me-sidebar className="flex h-full w-[248px] shrink-0 flex-col border-r border-black/10 bg-me-ivory">
      <div className="border-b border-black/8 px-3 py-3">
        <p className="mb-2 px-1 text-xs font-black uppercase tracking-[0.14em] text-me-charcoal/45">客户工作台</p>
        <ClientSwitcher clientId={clientId} clientName={clientName} clients={clients} pathname={pathname} />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section, i) => (
          <div key={i} className="mb-3">
            {section.title && <p className="mb-1 px-2 text-[10px] font-black uppercase tracking-[.14em] text-me-charcoal/40">{section.title}</p>}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <ClientNavLink key={item.key} item={item} active={item.key === activeKey} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
