'use client'

import { usePathname } from 'next/navigation'
import { MeMarkDefs, MeMark } from '@/components/ui/me-mark'
import { cx } from '@/components/ui/me-theme'
import Link from 'next/link'

interface Props {
  children: React.ReactNode
  userEmail: string
  userRole: string
  allowedClientId: string | null
  roleLabel: string
}

// ── Nav definition ────────────────────────────────────────────────────────────

type NavItem = { key: string; label: string; href?: string; mark: string; soon?: boolean }
type NavSection = { title?: string; items: NavItem[] }

const ADMIN_SECTIONS: NavSection[] = [
  {
    items: [
      { key: 'overview',  label: 'Overview', mark: 'OV', href: '/dashboard' },
      { key: 'clients',   label: 'Clients',  mark: 'CL', href: '/dashboard/clients' },
    ],
  },
  {
    title: 'Operate',
    items: [
      { key: 'launch-hub',       label: 'Launch Hub',      mark: 'LH', href: '/dashboard/visuals' },
      { key: 'analytics',        label: 'Analytics',       mark: 'AN', soon: true },
      { key: 'reports',          label: 'Reports',         mark: 'RP', href: '/dashboard/reports' },
      { key: 'billing-monitor',  label: 'Billing Monitor', mark: 'BM', href: '/dashboard/admin/billing-monitor' },
      { key: 'mtc-overview',     label: 'MTC Overview',    mark: 'MC', href: '/dashboard/admin/mtc-overview' },
      { key: 'ai-gateway',       label: 'AI Gateway',      mark: 'AG', href: '/dashboard/admin/ai-gateway' },
      { key: 'viral-references', label: 'Viral References',mark: 'VR', href: '/dashboard/admin/viral-references' },
      { key: 'user-console',     label: 'User Console',    mark: 'UC', href: '/dashboard/admin/users' },
      { key: 'industry-baselines', label: 'Industry Baselines', mark: 'IB', href: '/dashboard/industry-baselines' },
    ],
  },
]

// ── Sidebar nav item ──────────────────────────────────────────────────────────

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const cls = cx(
    'flex items-center gap-3 rounded-[10px] px-3 py-[10px] text-[13.5px] font-medium transition',
    active
      ? 'bg-[#C4912E]/16 text-[#EBCB8B]'
      : item.soon
        ? 'cursor-default text-white/25'
        : 'text-white/55 hover:bg-white/[.06] hover:text-[#FBF8F3]',
  )
  const mark = (
    <span className={cx(
      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-black',
      active ? 'bg-[#C4912E]/25 text-[#EBCB8B]' : 'bg-white/[.08] text-white/40',
    )}>
      {item.mark}
    </span>
  )
  const inner = (
    <>
      {mark}
      <span className="flex-1">{item.label}</span>
      {item.soon && (
        <span className="rounded bg-white/[.06] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-white/25">
          Soon
        </span>
      )}
    </>
  )

  if (item.soon || !item.href) return <div className={cls}>{inner}</div>
  return <Link href={item.href} className={cls}>{inner}</Link>
}

// ── DashboardShell ────────────────────────────────────────────────────────────

export default function DashboardShell({ children, userEmail, userRole, allowedClientId }: Props) {
  const pathname = usePathname()

  const activeKey = (() => {
    for (const section of ADMIN_SECTIONS) {
      for (const item of section.items) {
        if (!item.href) continue
        const exact = item.key === 'overview'
        if (exact ? pathname === item.href : (pathname === item.href || pathname.startsWith(item.href + '/'))) {
          return item.key
        }
      }
    }
    return ''
  })()

  // Client-viewer: simplified single-link sidebar
  const isClientViewer = userRole === 'client-viewer' && allowedClientId

  return (
    <div className="grid min-h-screen bg-[#FBF8F3] font-sans [grid-template-columns:248px_1fr] max-[720px]:grid-cols-1">
      <MeMarkDefs />

      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col bg-[#0D0D0D] md:flex">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-[11px] px-5 pb-5 pt-4">
          <MeMark className="h-7 w-8 flex-none" />
          <span className="leading-none">
            <span className="block whitespace-nowrap font-display text-[15px] font-bold text-[#FBF8F3]">
              Magic Engine
            </span>
            <span className="mt-[3px] block text-[10px] tracking-[.04em] text-white/35">
              Admin cockpit
            </span>
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {isClientViewer ? (
            <NavLink
              item={{ key: 'clients', label: 'My client', mark: 'CL', href: `/dashboard/clients/${allowedClientId}` }}
              active={pathname.startsWith(`/dashboard/clients/${allowedClientId}`)}
            />
          ) : (
            ADMIN_SECTIONS.map((section, i) => (
              <div key={i} className="mb-4">
                {section.title && (
                  <p className="mb-1.5 px-3 text-[9.5px] font-black uppercase tracking-[.16em] text-white/22">
                    {section.title}
                  </p>
                )}
                <div className="space-y-[2px]">
                  {section.items.map(item => (
                    <NavLink key={item.key} item={item} active={item.key === activeKey} />
                  ))}
                </div>
              </div>
            ))
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/[.07] px-4 py-3.5">
          <p className="truncate text-[11px] text-white/30">{userEmail}</p>
          <form action="/auth/signout" method="POST" className="mt-2.5">
            <button
              type="submit"
              className="flex h-9 w-full items-center justify-between rounded-lg border border-white/[.08] px-3 text-[12.5px] font-semibold text-white/40 transition hover:border-white/20 hover:text-white/70"
            >
              Sign out <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-black/10 bg-[#FBF8F3]/90 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2.5">
          <MeMark className="h-6 w-7" />
          <span className="font-display text-sm font-bold">Magic Engine</span>
        </div>
        <form action="/auth/signout" method="POST">
          <button type="submit" className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-semibold text-black/60">
            Sign out
          </button>
        </form>
      </header>

      {/* Main content */}
      <main className="min-w-0 flex-col">
        {children}
      </main>
    </div>
  )
}
