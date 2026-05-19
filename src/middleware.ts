import { NextRequest, NextResponse } from 'next/server'
import { createMiddlewareSupabaseClient } from '@/lib/supabase-server'
import { getUserPermissions } from '@/lib/auth/whitelist'

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  const supabase = createMiddlewareSupabaseClient(request, response)

  // Refresh session cookie if needed (keeps JWT alive)
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  const permissions = getUserPermissions(user.email ?? '')

  if (!permissions) {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  // Restrict client-viewer to their assigned client only
  if (permissions.role === 'client-viewer' && permissions.allowedClientId) {
    const allowedBase = `/dashboard/clients/${permissions.allowedClientId}`
    const path = request.nextUrl.pathname
    if (!path.startsWith(allowedBase)) {
      return NextResponse.redirect(new URL(allowedBase, request.url))
    }
  }

  // Forward role info to Server Components via request headers
  requestHeaders.set('x-user-role', permissions.role)
  if (permissions.allowedClientId) {
    requestHeaders.set('x-allowed-client-id', permissions.allowedClientId)
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
