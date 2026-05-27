import { NextRequest, NextResponse } from 'next/server'
import { runTracker } from '@/lib/ai-tracker/orchestrator'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type { AiEngine } from '@/types/magic-engine'

/**
 * POST /api/ai-tracker/run-dashboard
 *
 * Dashboard-facing wrapper around runTracker. Called by the "Run Now" button
 * in /dashboard/ai-visibility/[clientId]. Does not require CRON_SECRET.
 * Requires a valid Magic Link session with dashboard access to the requested
 * client.
 *
 * Body:  { client_id: string }
 * Response: same shape as /api/ai-tracker/run on success
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      client_id?: string
      query_ids?: string[]
      engines?: AiEngine[]
    }

    if (!body.client_id) {
      return NextResponse.json(
        { success: false, error: 'client_id is required' },
        { status: 400 }
      )
    }

    if (!/^[a-f0-9\-]{36}$/.test(body.client_id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid client_id format' },
        { status: 400 }
      )
    }

    const access = await requireDashboardClientAccess(body.client_id)
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status },
      )
    }

    // Fire-and-forget: Render is a persistent Node.js process so the promise
    // continues running after the HTTP response is sent. The client gets an
    // instant acknowledgement and can navigate away freely.
    void runTracker({
      client_id: body.client_id,
      query_ids: body.query_ids,
      engines:   body.engines,
    }).catch(err => {
      console.error(
        '[ai-tracker/run-dashboard] background run failed:',
        body.client_id,
        err instanceof Error ? err.message : err,
      )
    })

    return NextResponse.json({ success: true, status: 'started' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
