'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/components/ui/me-theme'

type RailItem = {
  key: string
  label: string
  href: string
  icon: string
  match: (path: string) => boolean
}

const RAIL: RailItem[] = [
  {
    key: 'home',
    label: '工作台',
    href: '/dashboard',
    icon: '⌂',
    match: (p) => p === '/dashboard' || /^\/dashboard\/clients\/[^/]+$/.test(p),
  },
  {
    key: 'today',
    label: '今日待办',
    href: '/dashboard/today',
    icon: '☰',
    match: (p) => p.startsWith('/dashboard/today'),
  },
  {
    key: 'clients',
    label: '客户',
    href: '/dashboard/clients',
    icon: '◎',
    match: (p) => p === '/dashboard/clients' || p.startsWith('/dashboard/clients/'),
  },
  {
    key: 'kernel',
    label: '审批',
    href: '/dashboard/kernel-approvals',
    icon: '✓',
    match: (p) =>
      p.startsWith('/dashboard/kernel-approvals') ||
      p.startsWith('/dashboard/ad-approval') ||
      p.startsWith('/dashboard/launch-signoff'),
  },
  {
    key: 'factory',
    label: '视频',
    href: '/dashboard/factory',
    icon: '▶',
    match: (p) => p.startsWith('/dashboard/factory'),
  },
  {
    key: 'system',
    label: '系统',
    href: '/dashboard/workflows-health',
    icon: '⚙',
    match: (p) =>
      p.startsWith('/dashboard/admin') ||
      p.startsWith('/dashboard/workflows-health') ||
      p.startsWith('/dashboard/team-memory') ||
      p.startsWith('/dashboard/me2'),
  },
]

export function GlobalPlatformRail({ clientHomeHref }: { clientHomeHref?: string | null }) {
  const pathname = usePathname() ?? ''

  return (
    <aside
      data-me-global-sidebar
      className="sticky top-0 flex h-screen w-[52px] shrink-0 flex-col items-center gap-1 border-r border-black/8 bg-[#F3EFE8] py-3"
    >
      {RAIL.map((item) => {
        const href = item.key === 'home' && clientHomeHref ? clientHomeHref : item.href
        const active = item.match(pathname)
        return (
          <Link
            key={item.key}
            href={href}
            title={item.label}
            className={cx(
              'flex h-10 w-10 items-center justify-center rounded-lg text-[15px] font-bold transition',
              active
                ? 'bg-me-ochre/18 text-me-ochre shadow-sm'
                : 'text-me-charcoal/45 hover:bg-white/80 hover:text-me-charcoal',
            )}
          >
            <span aria-hidden>{item.icon}</span>
          </Link>
        )
      })}
    </aside>
  )
}
