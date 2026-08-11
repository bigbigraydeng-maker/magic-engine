import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { publishPageUpgradeToGithub } from '@/lib/cms/github-page-upgrade-publisher'

interface RouteContext {
  params: { id: string }
}

interface RequestBody {
  page_id?: unknown
  page_url?: unknown
  enhanced_title?: unknown
  enhanced_meta_title?: unknown
  enhanced_meta_description?: unknown
  enhanced_html_body?: unknown
  execution_item_id?: unknown
}

const MAX_HTML_BYTES = 2_000_000

export async function POST(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return badInput('Invalid JSON body')
  }

  const required = {
    page_id: body.page_id,
    page_url: body.page_url,
    enhanced_title: body.enhanced_title,
    enhanced_meta_title: body.enhanced_meta_title,
    enhanced_meta_description: body.enhanced_meta_description,
    enhanced_html_body: body.enhanced_html_body,
  }
  for (const [key, value] of Object.entries(required)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return badInput(`${key} required`)
    }
  }

  try {
    const url = new URL(body.page_url as string)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return badInput('page_url must use http or https')
  } catch {
    return badInput('page_url must be a valid URL')
  }

  if ((body.enhanced_html_body as string).length > MAX_HTML_BYTES) {
    return badInput('enhanced_html_body is too large')
  }
  if (body.execution_item_id !== undefined && typeof body.execution_item_id !== 'string') {
    return badInput('execution_item_id must be a string')
  }

  const result = await publishPageUpgradeToGithub({
    clientId,
    pageId: body.page_id as string,
    pageUrl: body.page_url as string,
    enhancedTitle: body.enhanced_title as string,
    enhancedMetaTitle: body.enhanced_meta_title as string,
    enhancedMetaDescription: body.enhanced_meta_description as string,
    enhancedHtmlBody: body.enhanced_html_body as string,
    executionItemId: typeof body.execution_item_id === 'string' ? body.execution_item_id : undefined,
  })

  if (!result.ok) {
    const status = result.code === 'GITHUB_READ_ERROR'
      || result.code === 'GITHUB_WRITE_ERROR'
      || result.code === 'GITHUB_PR_ERROR'
      ? 502
      : 422
    return NextResponse.json(
      { success: false, error: result.reason, code: result.code },
      { status },
    )
  }

  return NextResponse.json({
    success: true,
    provider: 'github',
    pr_url: result.prUrl,
    pr_number: result.prNumber,
    branch: result.branchName,
    file_path: result.filePath,
    updated_fields: result.updatedFields,
    body_applied: result.bodyApplied,
    flywheel_action_id: result.flywheelActionId,
  })
}

function badInput(message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: message, code: 'INVALID_INPUT' },
    { status: 400 },
  )
}
