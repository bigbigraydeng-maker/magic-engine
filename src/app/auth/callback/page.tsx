'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useSearchParams } from 'next/navigation'

export default function AuthCallbackPage() {
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
      // getSession() auto-processes hash-fragment tokens (implicit flow).
      // If ?code= is present (PKCE flow), exchange it first.
      const code = searchParams.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          console.error('[auth/callback] exchangeCodeForSession:', error.message)
          window.location.href = '/login?error=auth_failed'
          return
        }
      } else {
        // For implicit-flow magic links, Supabase puts tokens in the hash.
        // getSession() picks them up automatically from window.location.hash.
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          window.location.href = '/login?error=auth_failed'
          return
        }
      }

      // Ask the server where this user should go (portal / dashboard / prospect)
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
