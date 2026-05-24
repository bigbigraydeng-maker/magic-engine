'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

interface SessionRouteResponse {
  redirect?: string
}

function loginPathFor(next: string): string {
  return next.startsWith('/portal') ? '/portal/login' : '/login'
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}

export default function ImplicitCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    async function finishLogin() {
      const params = new URLSearchParams(window.location.search)
      const next = safeNext(params.get('next'))
      const hash = new URLSearchParams(window.location.hash.slice(1))
      const hashError = hash.get('error') ?? hash.get('error_code')
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      const loginPath = loginPathFor(next)

      if (hashError) {
        router.replace(`${loginPath}?error=auth_failed&next=${encodeURIComponent(next)}`)
        return
      }

      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (error) {
          router.replace(`${loginPath}?error=auth_failed&next=${encodeURIComponent(next)}`)
          return
        }
      }

      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        router.replace(`${loginPath}?error=auth_failed&next=${encodeURIComponent(next)}`)
        return
      }

      const res = await fetch(`/api/auth/session-route?next=${encodeURIComponent(next)}`, {
        cache: 'no-store',
      })
      const route = await res.json() as SessionRouteResponse
      router.replace(route.redirect ?? next)
    }

    void finishLogin()
  }, [router])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-white">Signing you in...</h1>
        <p className="mt-2 text-sm text-gray-500">Finishing your Magic Engine session.</p>
      </div>
    </div>
  )
}
