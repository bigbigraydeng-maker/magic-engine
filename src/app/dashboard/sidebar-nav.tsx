'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = {
  href?: string
  label: string
  mark: string
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
      { href: '/dashboard', label: 'Overview', mark: 'OV', exact: true },
      { href: '/dashboard/clients', label: 'Clients', mark: 'CL' },
    ],
  },
  {
    title: 'Operate',
    items: [
      { href: '/dashboard/visuals', label: 'Launch Hub', mark: 'LH' },
      { label: 'Analytics', mark: 'AN', soon: true },
      { href: '/dashboard/reports', label: 'Reports', mark: 'RP' },
      { href: '/dashboard/admin/billing-monitor', label: 'Billing Monitor', mark: 'BM' },
      { href: '/dashboard/admin/mtc-overview', label: 'MTC Overview', mark: 'MC' },
      { href: '/dashboard/admin/ai-gateway', label: 'AI Gateway', mark: 'AG' },
      { href: '/dashboard/admin/viral-references', label: 'Viral References', mark: 'VR' },
      { href: '/dashboard/admin/users', label: 'User Console', mark: 'UC' },
      { href: '/dashboard/industry-baselines', label: 'Industry Baselines', mark: 'IB' },
    ],
  },
]

interface Props {
  userRole: string
  allowedClientId: string | null
  collapsed?: boolean
}

function Mark({ value, active = false }: { value: string; active?: boolean }) {
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-black ${
      active ? 'bg-slate-950 text-white' : 'bg-white/[0.08] text-slate-300'
    }`}>
      {value}
    </span>
  )
}

export default function SidebarNav({ userRole, allowedClientId, collapsed = false }: Props) {
  const pathname = usePathname()

  if (userRole === 'client-viewer' && allowedClientId) {
    const href = `/dashboard/clients/${allowedClientId}`
    const isActive = pathname === href || pathname.startsWith(href + '/')
    return (
      <nav className={`flex-1 px-3 py-4 ${collapsed ? 'space-y-2' : ''}`}>
        <Link
          href={href}
          title="My client"
          className={`flex items-center rounded-lg py-2.5 text-sm font-bold transition ${
            isActive
              ? 'bg-white text-slate-950'
              : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
          } ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'}`}
        >
          <Mark value="CL" active={isActive} />
          {!collapsed && 'My client'}
        </Link>
      </nav>
    )
  }

  return (
    <nav className={`flex-1 overflow-y-auto px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
      collapsed ? 'space-y-3' : 'space-y-5'
    }`}>
      {adminSections.map((section, sectionIndex) => (
        <div key={sectionIndex}>
          {section.title && !collapsed && (
            <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              {section.title}
            </p>
          )}
          <div className="space-y-1">
            {section.items.map((item) => {
              if (item.soon || !item.href) {
                return (
                  <div
                    key={item.label}
                    title={item.soon ? `${item.label} - Soon` : item.label}
                    className={`flex select-none items-center rounded-lg py-2.5 text-sm font-bold text-slate-600 ${
                      collapsed ? 'justify-center px-0' : 'gap-3 px-3'
                    }`}
                  >
                    <Mark value={item.mark} />
                    {!collapsed && (
                      <>
                        <span className="flex-1">{item.label}</span>
                        <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                          Soon
                        </span>
                      </>
                    )}
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
                  title={item.label}
                  className={`flex items-center rounded-lg py-2.5 text-sm font-bold transition ${
                    isActive
                      ? 'bg-white text-slate-950'
                      : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
                  } ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'}`}
                >
                  <Mark value={item.mark} active={isActive} />
                  {!collapsed && item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
