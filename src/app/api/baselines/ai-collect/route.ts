/**
 * POST /api/baselines/ai-collect — manually trigger a collection run (admin only).
 *
 * Body (optional):
 *   industries: string[]       — restrict to these industries (default: all active)
 *   platforms:  string[]       — restrict to these platforms (default: chatgpt + google_*)
 *   limit:      number         — cap N questions (testing)
 *
 * Returns:
 *   { run_id, status, ... summary stats }
 *
 * Long-running: the call may take 10-60s for ~10 questions. The UI should
 * either show a spinner or poll /api/baselines/ai-snapshots after it returns.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { runCollection } from '@/lib/industry-ai-visibility/orchestrator'
import type { Platform } from '@/lib/industry-ai-visibility/types'

export const maxDuration = 300  // Vercel: allow up to 5 minutes

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: {
    industries?: string[]
    platforms?:  Platform[]
    limit?:      number
  } = {}

  try {
    body = await req.json()
  } catch {
    // empty body is fine — defaults will apply
  }

  try {
    const summary = await runCollection({
      industries: body.industries,
      platforms:  body.platforms,
      limit:      body.limit,
      triggeredBy: 'admin_manual',
      triggeredByUser: admin.user.email ?? undefined,
    })
    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
