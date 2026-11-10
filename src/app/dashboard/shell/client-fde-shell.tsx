'use client'

import { usePathname } from 'next/navigation'
import { MeMarkDefs } from '@/components/ui/me-mark'
import type { ViewerFacts } from '@/lib/auth/home-entries'
import { DashboardTopBar } from './dashboard-top-bar'
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

  if (!clientId) {
    return <>{children}</>
  }

  return (
    <div data-me-shell className="flex min-h-screen flex-col bg-me-ivory font-sans">
      <MeMarkDefs />
      <DashboardTopBar contextLabel="客户工作台" userEmail={userEmail} />
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
