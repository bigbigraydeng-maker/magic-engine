/**
 * GET /api/auth/session-route?next=<path>
 *
 * Called by the client-side /auth/callback page after Supabase auth completes.
 * Reads the server-side session (set via cookie by the browser Supabase client)
 * and returns the correct redirect destination for this user type.
 *
 * The actual resolution + 500 MTC welcome-bonus grant lives in the shared
 * resolveRedirectForSession() so the OTP verify route reuses the exact same
 * logic (P0-B).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { resolveRedirectForSession } from '@/lib/auth/resolve-redirect'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const next = searchParams.get('next') ?? '/dashboard'
  const safePath = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'

  const supabase = createServerSupabaseClient()
  const redirect = await resolveRedirectForSession(supabase, safePath)
  return NextResponse.json({ redirect })
}
