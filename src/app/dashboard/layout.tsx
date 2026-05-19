import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import SidebarNav from './sidebar-nav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const headersList = await headers()
  const userRole = headersList.get('x-user-role') ?? 'admin'
  const allowedClientId = headersList.get('x-allowed-client-id') ?? null

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col min-h-screen">
        <div className="px-5 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <h1 className="text-lg font-bold text-white">Magic Engine</h1>
          </div>
          <p className="text-xs text-gray-500 mt-1 ml-7">
            {userRole === 'client-viewer' ? 'Client View' : 'Admin Dashboard'}
          </p>
        </div>

        <SidebarNav userRole={userRole} allowedClientId={allowedClientId} />

        <div className="px-4 py-4 border-t border-gray-800 space-y-2">
          <p className="text-xs text-gray-500 truncate">{user?.email ?? ''}</p>
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="w-full text-left text-xs text-gray-500 hover:text-white transition-colors py-1"
            >
              Sign out →
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  )
}
