'use client'

import Link from 'next/link'
import { cx } from '@/components/ui/me-theme'
import { activeNavKey, type NavItem, type NavSection } from './nav-active'

function PlatformNavLink({ item, active }: { item: NavItem; active: boolean }) {
  const cls = cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition', active ? 'bg-me-ochre/14 text-me-charcoal' : 'text-me-charcoal/70 hover:bg-black/[.04]')
  if (!item.href) return <div className={cls}>{item.label}</div>
  return <Link href={item.href} className={cls}>{item.mark} {item.label}</Link>
}

export function PlatformSidebar({ pathname, sections }: { pathname: string; sections: NavSection[] }) {
  const activeKey = activeNavKey(pathname, sections)
  return (
    <aside data-me-sidebar className="flex h-full w-[248px] shrink-0 flex-col border-r border-black/10 bg-me-ivory">
      <div className="border-b border-black/8 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-me-charcoal/45">总后台</div>
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {sections.map((section, i) => (
          <div key={i} className="mb-3">
            {section.title && <p className="mb-1 px-2 text-[10px] font-black uppercase text-me-charcoal/40">{section.title}</p>}
            {section.items.map((item) => <PlatformNavLink key={item.key} item={item} active={item.key === activeKey} />)}
          </div>
        ))}
      </nav>
    </aside>
  )
}
