'use client'

import { Suspense, useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useSearchParams } from 'next/navigation'

function AuthCallbackInner() {
  const searchParams = useSearchParams()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    const next = searchParams.get('next') ?? '/dashboard'
    const safePath = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'

    async function finish() {
      const code = searchParams.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          console.error('[auth/callback] exchangeCodeForSession:', error.message)
          window.location.href = '/login?error=auth_failed'
          return
        }
      } else {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          window.location.href = '/login?error=auth_failed'
          return
        }
      }

      try {
        const res = await fetch(`/api/auth/session-route?next=${encodeURIComponent(safePath)}`)
        if (res.ok) {
          const { redirect } = await res.json() as { redirect: string }
          window.location.href = redirect
          return
        }
      } catch (e) {
        console.error('[auth/callback] session-route error:', e)
      }

      window.location.href = safePath
    }

    finish()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400 text-sm">Authenticating…</p>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Authenticating…</p>
      </div>
    }>
      <AuthCallbackInner />
    </Suspense>
  )
}
