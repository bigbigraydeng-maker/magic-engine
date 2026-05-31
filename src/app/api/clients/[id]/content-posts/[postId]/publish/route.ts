/**
 * POST /api/clients/[id]/content-posts/[postId]/publish
 *
 * P21.7 — FDE 手动触发：将 AI Factory 生成的草稿发布到 Publer
 *
 * Body (all optional):
 *   scheduledAt  string   — ISO 8601，默认 1 小时后
 *
 * Flow:
 *   1. Auth check (dashboard client access)
 *   2. Verify post ownership + status == 'approved'
 *   3. Resolve Publer account (connector config or fallback)
 *   4. schedulePost() — text-only (no media)
 *   5. Update content_posts: status='scheduled', publer_post_id, scheduled_at
 *   6. Write flywheel_action social.schedule_post (non-blocking)
 *
 * Returns:
 *   { success, publerJobId, scheduledAt, provider }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { scheduleSocialPost } from '@/lib/flywheel/social-post-publish'

type RouteContext = { params: { id: string; postId: string } }

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, postId } = params

  // Auth guard
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    // body is optional — proceed with defaults
  }

  const scheduledAt = typeof body.scheduledAt === 'string' && body.scheduledAt
    ? body.scheduledAt
    : undefined

  const result = await scheduleSocialPost({ postId, clientId, scheduledAt })

  if (!result.ok) {
    const status = result.error.includes('not found') || result.error.includes('access denied')
      ? 404
      : result.error.includes('status is')
      ? 409
      : 500
    return NextResponse.json({ success: false, error: result.error }, { status })
  }

  return NextResponse.json({
    success:     true,
    publerJobId: result.publerJobId,
    scheduledAt: result.scheduledAt,
    provider:    result.provider,
  })
}
