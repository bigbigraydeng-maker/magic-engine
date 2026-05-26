'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

interface Props {
  clientId: string
  clientName: string
}

const NAV_ITEMS = (clientId: string) => [
  { href: `/portal/${clientId}`, label: 'Overview' },
  { href: `/portal/${clientId}/report`, label: 'Monthly report' },
  { href: `/portal/${clientId}/content`, label: 'Content library' },
]

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
      M
    </div>
  )
}

export default function PortalNav({ clientId, clientName }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    await supabase.auth.signOut()
    router.push('/portal/login')
  }

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950 text-white">
      <div className="mx-auto flex min-h-[72px] w-full max-w-6xl flex-col gap-4 px-5 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-4">
          <Link href={`/portal/${clientId}`} className="flex min-w-0 items-center gap-3">
            <LogoMark />
            <div className="min-w-0">
              <p className="text-sm font-black">Magic Engine</p>
              <p className="truncate text-xs font-semibold text-slate-400">{clientName}</p>
            </div>
          </Link>
          <button
            onClick={() => void handleSignOut()}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-white/30 hover:text-white lg:hidden"
          >
            Sign out
          </button>
        </div>

        <div className="flex items-center gap-3">
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg bg-white/[0.06] p-1">
            {NAV_ITEMS(clientId).map(item => {
              const active = item.href === `/portal/${clientId}`
                ? pathname === item.href
                : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-bold transition ${
                    active
                      ? 'bg-white text-slate-950'
                      : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <button
            onClick={() => void handleSignOut()}
            className="hidden h-9 shrink-0 items-center rounded-lg border border-white/15 px-3 text-xs font-bold text-slate-200 transition hover:border-white/30 hover:text-white lg:flex"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
