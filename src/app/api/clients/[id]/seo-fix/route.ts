/**
 * POST /api/clients/[id]/seo-fix
 *
 * Execute a CMS SEO metadata fix for a client.
 * Calls the seo-fix-orchestrator which:
 *   1. Reads the file from GitHub
 *   2. Patches the metadata in-memory
 *   3. Creates a branch and commits the change
 *   4. Opens a pull request
 *   5. Records the action in flywheel_actions
 *
 * Body: {
 *   file_path:             string   // relative path in repo
 *   slug:                  string   // identifies the object
 *   field:                 string   // e.g. "metaTitle"
 *   old_value:             string   // current value (for safety check)
 *   new_value:             string   // replacement value
 *   reason:                string   // human-readable change rationale
 *   execution_item_id?:    string
 *   production_package_id?: string
 * }
 *
 * Security: requires INTERNAL_API_KEY bearer token.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBearerToken } from '@/lib/validation-utils'
import { orchestrateSeoFix } from '@/lib/cms/seo-fix-orchestrator'
import type { CmsSeoFixPayload } from '@/lib/cms/vocabulary'

interface RouteContext {
  params: { id: string }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const clientId = params.id
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'client id required', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }

  const {
    file_path, slug, field, old_value, new_value, reason,
    execution_item_id, production_package_id,
  } = body as Record<string, unknown>

  // Validate required fields
  const stringFields = { file_path, slug, field, old_value, new_value, reason }
  for (const [key, val] of Object.entries(stringFields)) {
    if (typeof val !== 'string' || !val.trim()) {
      return NextResponse.json(
        { success: false, error: `${key} required`, code: 'INVALID_INPUT' },
        { status: 400 },
      )
    }
  }

  const fix: CmsSeoFixPayload = {
    filePath: (file_path as string).trim(),
    slug:     (slug     as string).trim(),
    field:    (field    as string).trim(),
    oldValue: (old_value as string),
    newValue: (new_value as string),
    reason:   (reason   as string).trim(),
  }

  try {
    const result = await orchestrateSeoFix({
      clientId,
      executionItemId:    typeof execution_item_id    === 'string' ? execution_item_id    : undefined,
      productionPackageId: typeof production_package_id === 'string' ? production_package_id : undefined,
      fix,
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
    console.error('[seo-fix]', clientId, err instanceof Error ? err.message : err)
    return NextResponse.json(
      { success: false, error: 'Unexpected error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
