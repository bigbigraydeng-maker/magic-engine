'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = {
  href?: string
  label: string
  emoji: string
  exact?: boolean
  soon?: boolean
}

type NavSection = {
  title?: string
  items: NavItem[]
}

const adminSections: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: 'Overview', emoji: '🏠', exact: true },
      { href: '/dashboard/clients', label: 'Clients', emoji: '👥' },
    ],
  },
  {
    title: '工具',
    items: [
      { href: '/dashboard/visuals',               label: 'Launch Hub',     emoji: '🚀' },
      {                                             label: 'Analytics',      emoji: '📈', soon: true },
      { href: '/dashboard/reports',               label: 'Reports',        emoji: '📊' },
      { href: '/dashboard/admin/billing-monitor',   label: 'Billing Monitor',  emoji: '💳' },
      { href: '/dashboard/admin/viral-references',  label: 'Viral References', emoji: '🎬' },
      { href: '/dashboard/admin/users',             label: 'User Console',     emoji: '👤' },
    ],
  },
]

interface Props {
  userRole: string
  allowedClientId: string | null
}

export default function SidebarNav({ userRole, allowedClientId }: Props) {
  const pathname = usePathname()

  if (userRole === 'client-viewer' && allowedClientId) {
    return (
      <nav className="flex-1 px-3 py-4">
        <Link
          href={`/dashboard/clients/${allowedClientId}`}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          <span className="text-base">👥</span>
          My Client
        </Link>
      </nav>
    )
  }

  return (
    <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
      {adminSections.map((section, si) => (
        <div key={si}>
          {section.title && (
            <p className="px-3 mb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
              {section.title}
            </p>
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              if (item.soon || !item.href) {
                return (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 opacity-40 cursor-not-allowed select-none"
                  >
                    <span className="text-base">{item.emoji}</span>
                    <span className="flex-1">{item.label}</span>
                    <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">Soon</span>
                  </div>
                )
              }
              const isActive = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <span className="text-base">{item.emoji}</span>
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
