import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import DashboardShell from './dashboard-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const headersList = await headers()
  const userRole = headersList.get('x-user-role') ?? 'admin'
  const allowedClientId = headersList.get('x-allowed-client-id') ?? null
  const roleLabel = userRole === 'client-viewer' ? 'Client view' : 'Admin cockpit'

  return (
    <DashboardShell
      userEmail={user.email ?? ''}
      userRole={userRole}
      allowedClientId={allowedClientId}
      roleLabel={roleLabel}
    >
      {children}
    </DashboardShell>
  )
}
