'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/components/ui/me-theme'

const RAIL = [
  { href: '/dashboard', icon: '⌂', match: (p: string) => p === '/dashboard' || /^\/dashboard\/clients\/[^/]+$/.test(p) },
  { href: '/dashboard/today', icon: '☰', match: (p: string) => p.startsWith('/dashboard/today') },
  { href: '/dashboard/clients', icon: '◎', match: (p: string) => p.startsWith('/dashboard/clients') },
  { href: '/dashboard/kernel-approvals', icon: '✓', match: (p: string) => p.includes('approval') || p.includes('launch-signoff') },
  { href: '/dashboard/factory', icon: '▶', match: (p: string) => p.startsWith('/dashboard/factory') },
  { href: '/dashboard/workflows-health', icon: '⚙', match: (p: string) => p.startsWith('/dashboard/admin') || p.startsWith('/dashboard/workflows') || p.startsWith('/dashboard/me2') },
] as const

export function GlobalPlatformRail({ clientHomeHref }: { clientHomeHref?: string | null }) {
  const pathname = usePathname() ?? ''
  return (
    <aside data-me-global-sidebar className="sticky top-0 flex h-screen w-[52px] shrink-0 flex-col items-center gap-1 border-r border-black/8 bg-[#F3EFE8] py-3">
      {RAIL.map((item, i) => {
        const href = i === 0 && clientHomeHref ? clientHomeHref : item.href
        const active = item.match(pathname)
        return (
          <Link key={item.href} href={href} className={cx('flex h-10 w-10 items-center justify-center rounded-lg text-[15px] font-bold transition', active ? 'bg-me-ochre/18 text-me-ochre' : 'text-me-charcoal/45 hover:bg-white/80')}>
            {item.icon}
          </Link>
        )
      })}
    </aside>
  )
}
