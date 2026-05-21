import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { User } from '@supabase/supabase-js'

/**
 * Session guard for /api route handlers.
 *
 * src/middleware.ts authenticates /dashboard and /portal *page* requests, but
 * its matcher does not cover /api/* — so every API route that reads client
 * data or triggers paid external calls must verify the caller's session
 * itself. Same-origin browser fetches send the Supabase auth cookie
 * automatically; createServerSupabaseClient() reads it via next/headers.
 *
 * Fail-closed: any request without a valid logged-in user is rejected with
 * 401, mirroring the middleware's redirect-to-login for unauthenticated pages.
 */

export type SessionResult =
  | { ok: true; user: User }
  | { ok: false; status: 401; error: string }

export async function requireSession(): Promise<SessionResult> {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  return { ok: true, user }
}
