'use client'

import { usePathname } from 'next/navigation'
import { MeMarkDefs } from '@/components/ui/me-mark'
import { ADMIN_SECTIONS } from '../admin-sections'
import type { ViewerFacts } from '@/lib/auth/home-entries'
import { DashboardTopBar } from './dashboard-top-bar'
import { GlobalPlatformRail } from './global-platform-rail'
import { PlatformSidebar } from './platform-sidebar'
import { ClientWorkbenchSidebar } from './client-workbench-sidebar'
import { useClientShellData } from './use-client-shell-data'

function clientIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/dashboard\/clients\/([^/]+)/)
  return m?.[1] ?? null
}

export function FdeAdminShell({
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
  const routeClientId = clientIdFromPath(pathname)
  const clientId = routeClientId ?? allowedClientId
  const inClientTree = Boolean(routeClientId)
  const { clients, industry, goalHref, currentName } = useClientShellData(clientId)

  const contextLabel = inClientTree ? '客户工作台' : '总后台'
  const clientHomeHref = clientId ? `/dashboard/clients/${clientId}` : null

  return (
    <div data-me-shell className="flex min-h-screen bg-me-ivory font-sans">
      <MeMarkDefs />
      <GlobalPlatformRail clientHomeHref={clientHomeHref} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopBar contextLabel={contextLabel} userEmail={userEmail} />
        <div className="flex min-h-0 flex-1">
          {inClientTree && clientId ? (
            <ClientWorkbenchSidebar
              clientId={clientId}
              clientName={currentName}
              clients={clients}
              industry={industry}
              goalHref={goalHref}
              facts={facts}
              pathname={pathname}
            />
          ) : (
            <PlatformSidebar pathname={pathname} sections={ADMIN_SECTIONS} />
          )}
          <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
        </div>
      </div>
    </div>
  )
}
