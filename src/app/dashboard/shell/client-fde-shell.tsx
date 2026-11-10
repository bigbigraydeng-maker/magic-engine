'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { MeMarkDefs, MeMark } from '@/components/ui/me-mark'
import type { ViewerFacts } from '@/lib/auth/home-entries'
import { ClientWorkbenchSidebar } from './client-workbench-sidebar'
import { useClientShellData } from './use-client-shell-data'

function clientIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/dashboard\/clients\/([^/]+)/)
  return m?.[1] ?? null
}

/** Step 1 — client workbench only: top bar + switcher + grouped client nav. */
export function ClientFdeShell({
  children,
  userEmail,
  facts,
  allowedClientId,
}: {
  children: React.ReactNode
  userEmail: string
  facts: ViewerFacts
  allowedClientId: string | null
}) {
  const pathname = usePathname() ?? ''
  const clientId = clientIdFromPath(pathname) ?? allowedClientId
  const { clients, industry, goalHref, currentName } = useClientShellData(clientId)
  const initial = (userEmail.trim()[0] ?? 'M').toUpperCase()

  if (!clientId) return <>{children}</>

  return (
    <div data-me-shell className="flex min-h-screen flex-col bg-me-ivory font-sans">
      <MeMarkDefs />
      <header className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center justify-between border-b border-black/10 bg-me-ivory/95 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <MeMark className="h-6 w-7" />
            <span className="font-display text-sm font-bold text-me-charcoal">Magic Engine</span>
          </Link>
          <span className="text-me-charcoal/25" aria-hidden>|</span>
          <span className="truncate text-sm font-semibold text-me-charcoal/70">客户工作台</span>
        </div>
        <p className="flex h-8 w-8 items-center justify-center rounded-full bg-me-charcoal text-xs font-black text-white" title={userEmail}>{initial}</p>
      </header>
      <div className="flex min-h-0 flex-1">
        <ClientWorkbenchSidebar
          clientId={clientId}
          clientName={currentName}
          clients={clients}
          industry={industry}
          goalHref={goalHref}
          facts={facts}
          pathname={pathname}
        />
        <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
      </div>
    </div>
  )
}
