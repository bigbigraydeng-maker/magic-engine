'use client'

import { useEffect, useState } from 'react'
import SidebarNav from './sidebar-nav'

interface Props {
  children: React.ReactNode
  userEmail: string
  userRole: string
  allowedClientId: string | null
  roleLabel: string
}

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
      M
    </div>
  )
}

const LOOP_STEPS = ['Diagnose', 'Execute', 'Prove']

export default function DashboardShell({
  children,
  userEmail,
  userRole,
  allowedClientId,
  roleLabel,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setCollapsed(window.localStorage.getItem('magic-engine:dashboard-sidebar') === 'collapsed')
    setHydrated(true)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value
      window.localStorage.setItem('magic-engine:dashboard-sidebar', next ? 'collapsed' : 'expanded')
      return next
    })
  }

  const isCollapsed = hydrated && collapsed

  return (
    <div className="flex min-h-screen bg-[#f6f7f2] text-slate-950">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-white/10 bg-slate-950 text-white transition-[width] duration-200 md:flex ${
          isCollapsed ? 'w-20' : 'w-72'
        }`}
      >
        <div className={`border-b border-white/10 py-5 ${isCollapsed ? 'px-3' : 'px-5'}`}>
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
            <LogoMark />
            {!isCollapsed && (
              <div className="min-w-0">
                <h1 className="text-sm font-black">Magic Engine</h1>
                <p className="mt-0.5 text-xs font-semibold text-slate-400">{roleLabel}</p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={toggleCollapsed}
            className={`mt-4 flex h-9 w-full items-center rounded-lg border border-white/10 bg-white/[0.06] text-xs font-black text-slate-300 transition hover:border-white/25 hover:text-white ${
              isCollapsed ? 'justify-center' : 'justify-between px-3'
            }`}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {!isCollapsed && <span>Collapse menu</span>}
            <span aria-hidden="true">{isCollapsed ? '>>' : '<<'}</span>
          </button>

          <div className={`mt-4 rounded-lg border border-white/10 bg-white/[0.06] ${isCollapsed ? 'p-2' : 'p-3'}`}>
            {!isCollapsed && (
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200">
                Operating loop
              </p>
            )}
            <div className={isCollapsed ? 'space-y-1' : 'mt-3 grid grid-cols-3 gap-1'}>
              {LOOP_STEPS.map(step => (
                <div
                  key={step}
                  title={step}
                  className={`rounded-md bg-slate-950/70 text-center font-bold text-slate-300 ${
                    isCollapsed ? 'px-2 py-2 text-[10px]' : 'px-2 py-2 text-[11px]'
                  }`}
                >
                  {isCollapsed ? step.slice(0, 1) : step}
                </div>
              ))}
            </div>
          </div>
        </div>

        <SidebarNav userRole={userRole} allowedClientId={allowedClientId} collapsed={isCollapsed} />

        <div className={`border-t border-white/10 py-4 ${isCollapsed ? 'px-3' : 'px-4'}`}>
          {!isCollapsed && <p className="truncate text-xs font-semibold text-slate-400">{userEmail}</p>}
          <form action="/auth/signout" method="POST" className={isCollapsed ? '' : 'mt-3'}>
            <button
              type="submit"
              className={`flex h-10 w-full items-center rounded-lg border border-white/10 text-sm font-bold text-slate-200 transition hover:border-white/25 hover:text-white ${
                isCollapsed ? 'justify-center px-0' : 'justify-between px-3'
              }`}
              title="Sign out"
            >
              {isCollapsed ? 'SO' : 'Sign out'}
              {!isCollapsed && <span aria-hidden="true">-&gt;</span>}
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 bg-[#f6f7f2]">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-[#f6f7f2]/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <LogoMark />
              <div className="min-w-0">
                <p className="truncate text-sm font-black">Magic Engine</p>
                <p className="text-xs font-semibold text-slate-500">{roleLabel}</p>
              </div>
            </div>
            <form action="/auth/signout" method="POST">
              <button
                type="submit"
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs font-black text-slate-700"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        {children}
      </main>
    </div>
  )
}
