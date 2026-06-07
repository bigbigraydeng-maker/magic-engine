import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import DashboardShell from './dashboard-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const headersList = await headers()
  // P0-J fix (魏征 漏洞 A): tier fallback was 'admin' — any missing header
  // would silently escalate to admin privileges. Fail-safe to the lowest
  // tier ('portal_only' = read-only single client) so a misconfigured
  // middleware can never accidentally grant admin.
  const userRole = headersList.get('x-user-role') ?? 'client-viewer'
  const userTier = (headersList.get('x-user-tier') ?? 'portal_only') as
    'admin' | 'paid_client' | 'self_serve' | 'portal_only'
  const allowedClientId = headersList.get('x-allowed-client-id') ?? null
  const roleLabel = userRole === 'client-viewer' ? 'Client view' : 'Admin cockpit'

  return (
    <DashboardShell
      userEmail={user.email ?? ''}
      userRole={userRole}
      userTier={userTier}
      allowedClientId={allowedClientId}
      roleLabel={roleLabel}
    >
      {children}
    </DashboardShell>
  )
}
