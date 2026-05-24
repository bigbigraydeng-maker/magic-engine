/**
 * GET /api/auth/google-login?next=<path>
 *
 * Server-side Google OAuth initiation. Using the server client ensures the
 * PKCE code verifier is written into response cookies (not localStorage),
 * so it survives the cross-origin OAuth redirect and can be read by the
 * callback page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const next = searchParams.get('next') ?? '/dashboard'
  const safePath = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'

  // Use explicit env var first; otherwise reconstruct from forwarded headers
  // (request.nextUrl.origin returns Render's internal localhost:PORT, not the public URL)
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3001'
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0] ?? (host.startsWith('localhost') ? 'http' : 'https')
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`).replace(/\/$/, '')
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(safePath)}`

  const cookieStore = cookies()
  type PendingCookie = { name: string; value: string; options?: Record<string, unknown> }
  const pendingCookies: PendingCookie[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) {
          list.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options: options as Record<string, unknown> })
          })
        },
      },
    },
  )

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  })

  if (error || !data.url) {
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url))
  }

  // Redirect to Google OAuth URL, carrying the PKCE code verifier in cookies
  const response = NextResponse.redirect(data.url)
  pendingCookies.forEach(({ name, value, options }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response.cookies.set(name, value, options as any)
  })
  return response
}
