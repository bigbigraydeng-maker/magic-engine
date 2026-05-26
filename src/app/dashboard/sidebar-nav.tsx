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
      { href: '/dashboard/admin/viral-references', label: 'Viral References', mark: 'VR' },
      { href: '/dashboard/admin/users', label: 'User Console', mark: 'UC' },
    ],
  },
]

interface Props {
  userRole: string
  allowedClientId: string | null
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

export default function SidebarNav({ userRole, allowedClientId }: Props) {
  const pathname = usePathname()

  if (userRole === 'client-viewer' && allowedClientId) {
    const href = `/dashboard/clients/${allowedClientId}`
    const isActive = pathname === href || pathname.startsWith(href + '/')
    return (
      <nav className="flex-1 px-3 py-4">
        <Link
          href={href}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition ${
            isActive
              ? 'bg-white text-slate-950'
              : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
          }`}
        >
          <Mark value="CL" active={isActive} />
          My client
        </Link>
      </nav>
    )
  }

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {adminSections.map((section, sectionIndex) => (
        <div key={sectionIndex}>
          {section.title && (
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
                    className="flex select-none items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-600"
                  >
                    <Mark value={item.mark} />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                      Soon
                    </span>
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
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition ${
                    isActive
                      ? 'bg-white text-slate-950'
                      : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <Mark value={item.mark} active={isActive} />
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
