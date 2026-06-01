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
import { getPublicOrigin } from '@/lib/auth/public-origin'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const next = searchParams.get('next') ?? '/dashboard'
  const safePath = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
  const selfServeIntent = searchParams.get('intent') === 'self_serve'

  const origin = getPublicOrigin(request)
  const callbackUrl = new URL(`${origin}/auth/callback`)
  callbackUrl.searchParams.set('next', safePath)
  if (selfServeIntent) callbackUrl.searchParams.set('intent', 'self_serve')
  const redirectTo = callbackUrl.toString()

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
    const failedPath = selfServeIntent
      ? '/portal/register'
      : safePath.startsWith('/portal') || safePath === '/prospect'
        ? '/portal/login'
        : '/login'
    return NextResponse.redirect(
      `${origin}${failedPath}?error=auth_failed&next=${encodeURIComponent(safePath)}`,
    )
  }

  // Redirect to Google OAuth URL, carrying the PKCE code verifier in cookies
  const response = NextResponse.redirect(data.url)
  pendingCookies.forEach(({ name, value, options }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response.cookies.set(name, value, options as any)
  })
  return response
}
