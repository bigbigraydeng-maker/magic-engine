'use client'

import { LightNavLink } from './light-nav-link'
import { activeNavKey } from './nav-active'
import type { NavSection } from './nav-types'

export function PlatformSidebar({
  pathname,
  sections,
}: {
  pathname: string
  sections: NavSection[]
}) {
  const activeKey = activeNavKey(pathname, sections)

  return (
    <aside
      data-me-sidebar
      className="flex h-full w-[248px] shrink-0 flex-col border-r border-black/10 bg-me-ivory"
    >
      <div className="border-b border-black/8 px-4 py-3">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-me-charcoal/45">总后台</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section, i) =>
          section.collapsed ? (
            <details key={i} className="mb-3" open={section.items.some((item) => item.key === activeKey)}>
              <summary className="mb-1 cursor-pointer select-none px-2 text-[10px] font-black uppercase tracking-[.14em] text-me-charcoal/40">
                {section.title} ▾
              </summary>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <LightNavLink key={item.key} item={item} active={item.key === activeKey} />
                ))}
              </div>
            </details>
          ) : (
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
          ),
        )}
      </nav>
    </aside>
  )
}
