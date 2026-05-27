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
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { orchestrateSeoFix } from '@/lib/cms/seo-fix-orchestrator'
import type { CmsSeoFixPayload } from '@/lib/cms/vocabulary'

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

  // Validate required non-empty string fields
  const requiredFields = { file_path, slug, field, new_value, reason }
  for (const [key, val] of Object.entries(requiredFields)) {
    if (typeof val !== 'string' || !val.trim()) {
      return NextResponse.json(
        { success: false, error: `${key} required`, code: 'INVALID_INPUT' },
        { status: 400 },
      )
    }
  }
  // old_value may be empty string (legitimate when patching a missing field)
  if (typeof old_value !== 'string') {
    return NextResponse.json(
      { success: false, error: 'old_value must be a string', code: 'INVALID_INPUT' },
      { status: 400 },
    )
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
