/**
 * POST /api/clients/[id]/cms/publish-blog
 *
 * Push a generated blog post to the client's GitHub repo as a PR.
 *
 * Body: { blog_post_id: string, execution_item_id?: string }
 *
 * Returns: { success, pr_url, pr_number, branch, flywheel_action_id }
 *
 * Security: requires INTERNAL_API_KEY bearer token.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { publishBlogToGitHub } from '@/lib/cms/blog-publisher'

interface RouteContext {
  params: { id: string }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  if (!clientId) {
    return NextResponse.json({ success: false, error: 'client id required' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { blog_post_id, execution_item_id } = body

  if (typeof blog_post_id !== 'string' || !blog_post_id.trim()) {
    return NextResponse.json({ success: false, error: 'blog_post_id required' }, { status: 400 })
  }

  try {
    const result = await publishBlogToGitHub({
      clientId,
      blogPostId:      blog_post_id.trim(),
      executionItemId: typeof execution_item_id === 'string' ? execution_item_id : undefined,
    })

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.reason, code: result.code },
        { status: 422 },
      )
    }

    return NextResponse.json({
      success:            true,
      pr_url:             result.prUrl,
      pr_number:          result.prNumber,
      branch:             result.branchName,
      flywheel_action_id: result.flywheelActionId,
    })
  } catch (err) {
    console.error('[publish-blog]', clientId, err instanceof Error ? err.message : err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
}
