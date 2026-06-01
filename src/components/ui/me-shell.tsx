'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MeMark, MeMarkDefs } from './me-mark'
import { cx } from './me-theme'

export type MeNavItem = {
  key: string
  label: string
  href: string
  icon?: React.ReactNode
  soon?: boolean
}

export type MeNavSection = {
  title?: string
  items: MeNavItem[]
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function SidebarLink({ item, active }: { item: MeNavItem; active: boolean }) {
  const cls = cx(
    'flex items-center gap-3 rounded-[11px] px-3 py-[11px] text-[14px] font-medium transition',
    active
      ? 'bg-[#C4912E]/16 text-[#EBCB8B]'
      : 'text-white/60 hover:bg-white/[.06] hover:text-[#FBF8F3]',
    item.soon && 'pointer-events-none opacity-50',
  )
  const inner = (
    <>
      {item.icon && (
        <span className="h-[18px] w-[18px] flex-none opacity-80">{item.icon}</span>
      )}
      {!item.icon && (
        <span className={cx(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-black',
          active ? 'bg-[#C4912E]/30 text-[#EBCB8B]' : 'bg-white/[.08] text-white/50',
        )}>
          {item.key.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="flex-1">{item.label}</span>
      {item.soon && (
        <span className="rounded-md bg-white/[.06] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[.1em] text-white/30">
          Soon
        </span>
      )}
    </>
  )

  if (item.soon || !item.href) {
    return <div className={cls}>{inner}</div>
  }
  return <Link href={item.href} className={cls}>{inner}</Link>
}

export function MeSidebar({
  sections,
  active,
  userEmail,
}: {
  sections: MeNavSection[]
  active: string
  userEmail?: string
}) {
  return (
    <aside className="sticky top-0 flex h-screen w-[248px] flex-col overflow-hidden bg-[#0D0D0D] text-[#FBF8F3]">
      <MeMarkDefs />
      {/* Logo */}
      <Link href="/dashboard" className="flex items-center gap-[11px] px-5 pb-5 pt-4">
        <MeMark className="h-7 w-8 flex-none" />
        <span className="leading-none">
          <span className="block whitespace-nowrap font-display text-[15px] font-bold">Magic Engine</span>
          <span className="mt-[3px] block text-[10px] tracking-[.04em] text-white/40">Admin cockpit</span>
        </span>
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section, i) => (
          <div key={i} className="mb-4">
            {section.title && (
              <p className="mb-1.5 px-3 text-[9.5px] font-black uppercase tracking-[.16em] text-white/25">
                {section.title}
              </p>
            )}
            <div className="space-y-[2px]">
              {section.items.map(item => (
                <SidebarLink
                  key={item.key}
                  item={item}
                  active={item.key === active}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-white/[.06] px-5 py-3.5 text-[11px] text-white/30">
        <span className="h-1.5 w-1.5 rounded-full bg-[#5C8A4A]" />
        {userEmail ?? 'Internal Use'}
      </div>
    </aside>
  )
}

// ── Topbar ────────────────────────────────────────────────────────────────────

export function MeTopbar({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-5 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-[3px] text-[13px] text-black/55">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </header>
  )
}

// ── AdminShell ────────────────────────────────────────────────────────────────

export function MeAdminShell({
  sections,
  active,
  userEmail,
  children,
}: {
  sections: MeNavSection[]
  active: string
  userEmail?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid min-h-screen bg-[#FBF8F3] font-sans [grid-template-columns:248px_1fr] max-[720px]:grid-cols-1">
      <div className="max-[720px]:hidden">
        <MeSidebar sections={sections} active={active} userEmail={userEmail} />
      </div>
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  )
}

// ── ActiveKey helper: derive nav key from pathname ────────────────────────────

export function useActiveNavKey(sections: MeNavSection[]): string {
  const pathname = usePathname()
  for (const section of sections) {
    for (const item of section.items) {
      if (!item.href) continue
      if (pathname === item.href || pathname.startsWith(item.href + '/')) {
        return item.key
      }
    }
  }
  return ''
}
