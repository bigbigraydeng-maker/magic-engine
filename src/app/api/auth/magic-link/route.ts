/**
 * POST /api/auth/magic-link
 *
 * Retired. Portal and admin sign-in are email/password plus Google only, so
 * this endpoint no longer generates links or sends email. It is kept as a
 * no-store 410 so any stale client fails loudly instead of silently.
 */

import { NextResponse } from 'next/server'

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Magic-link sign-in is no longer available. Use email and password or Google.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}
