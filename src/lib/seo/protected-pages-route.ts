/**
 * Route-side helpers for the protected-page gate: turn the logged-in user of a
 * human-triggered write route into a `PageWriteGuard`, and map a refusal to a
 * 403 response. Kept apart from `protected-pages.ts` so that module stays free
 * of Next.js / server-client imports (it is also used from capabilities/).
 *
 * The identity of the PAGE is never computed here — the write function computes
 * it from the target it really writes. This file only says WHO is acting.
 */

import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import {
  createPageWriteGuard,
  ProtectedPageError,
  resolveActorFromEmail,
  type PageWriteGuard,
} from './protected-pages'

/** Call AFTER the route's own client-access check; `user` is that check's verified user. */
export function buildRouteGuard(user: User, clientId: string, route: string): PageWriteGuard {
  const actor = resolveActorFromEmail(user.email, Boolean(user.email_confirmed_at))
  return createPageWriteGuard({ supabase: supabaseAdmin, clientId, actor, route })
}

/** Returns a 403 response for a gate refusal, or null when the error is something else. */
export function protectedPageResponse(err: unknown): NextResponse | null {
  if (!(err instanceof ProtectedPageError)) return null
  return NextResponse.json(
    {
      success: false,
      error: 'This page is on the protected-page list. Only the account owner can change it.',
      code: 'PROTECTED_PAGE',
    },
    { status: err.status },
  )
}
