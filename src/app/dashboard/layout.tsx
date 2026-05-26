import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import SidebarNav from './sidebar-nav'

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
      M
    </div>
  )
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const headersList = await headers()
  const userRole = headersList.get('x-user-role') ?? 'admin'
  const allowedClientId = headersList.get('x-allowed-client-id') ?? null
  const roleLabel = userRole === 'client-viewer' ? 'Client view' : 'Admin cockpit'

  return (
    <div className="flex h-screen bg-[#f6f7f2] text-slate-950">
      <aside className="flex min-h-screen w-72 shrink-0 flex-col border-r border-white/10 bg-slate-950 text-white">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="flex items-center gap-3">
            <LogoMark />
            <div className="min-w-0">
              <h1 className="text-sm font-black">Magic Engine</h1>
              <p className="mt-0.5 text-xs font-semibold text-slate-400">{roleLabel}</p>
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.06] p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200">
              Operating loop
            </p>
            <div className="mt-3 grid grid-cols-3 gap-1">
              {['Diagnose', 'Execute', 'Prove'].map(step => (
                <div key={step} className="rounded-md bg-slate-950/70 px-2 py-2 text-center text-[11px] font-bold text-slate-300">
                  {step}
                </div>
              ))}
            </div>
          </div>
        </div>

        <SidebarNav userRole={userRole} allowedClientId={allowedClientId} />

        <div className="border-t border-white/10 px-4 py-4">
          <p className="truncate text-xs font-semibold text-slate-400">{user?.email ?? ''}</p>
          <form action="/auth/signout" method="POST" className="mt-3">
            <button
              type="submit"
              className="flex h-10 w-full items-center justify-between rounded-lg border border-white/10 px-3 text-sm font-bold text-slate-200 transition hover:border-white/25 hover:text-white"
            >
              Sign out
              <span aria-hidden="true">-&gt;</span>
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto bg-[#f6f7f2]">
        {children}
      </main>
    </div>
  )
}
