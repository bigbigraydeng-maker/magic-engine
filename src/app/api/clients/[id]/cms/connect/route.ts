/**
 * POST  /api/clients/[id]/cms/connect — save full GitHub CMS connection
 * PATCH /api/clients/[id]/cms/connect — update content_targets only (no PAT)
 * DELETE /api/clients/[id]/cms/connect — remove the connection
 *
 * POST body: {
 *   repo_owner:      string
 *   repo_name:       string
 *   default_branch:  string?  // default "main"
 *   content_paths:   string[] // legacy meta-patcher target list (kept for compat)
 *   content_targets: CmsContentTarget[] // B1: typed GEO injection targets
 *   token:           string   // plain-text GitHub PAT (encrypted before storage)
 * }
 *
 * PATCH body: { content_targets: CmsContentTarget[] }
 *
 * Security: requireDashboardClientAccess (session-cookie auth).
 * The plain-text PAT is NEVER logged or echoed back.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import {
  upsertConnection,
  deleteConnection,
  updateContentTargets,
} from '@/lib/cms/connection-store'

interface RouteContext {
  params: { id: string }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
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
    repo_owner,
    repo_name,
    default_branch,
    content_paths,
    content_targets,
    token,
  } = body as {
    repo_owner?:      unknown
    repo_name?:       unknown
    default_branch?:  unknown
    content_paths?:   unknown
    content_targets?: unknown
    token?:           unknown
  }

  if (typeof repo_owner !== 'string' || !repo_owner.trim()) {
    return NextResponse.json(
      { success: false, error: 'repo_owner required', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }
  if (typeof repo_name !== 'string' || !repo_name.trim()) {
    return NextResponse.json(
      { success: false, error: 'repo_name required', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }
  if (typeof token !== 'string' || token.trim().length < 10) {
    return NextResponse.json(
      { success: false, error: 'token required (min 10 chars)', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }

  const parsedPaths = Array.isArray(content_paths)
    ? (content_paths as unknown[]).filter((p): p is string => typeof p === 'string')
    : []

  try {
    const status = await upsertConnection({
      clientId,
      repoOwner:      repo_owner.trim(),
      repoName:       repo_name.trim(),
      defaultBranch:  typeof default_branch === 'string' ? default_branch.trim() : 'main',
      contentPaths:   parsedPaths,
      contentTargets: content_targets,
      plainToken:     token.trim(),
    })

    return NextResponse.json({ success: true, data: status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // Validation errors from normaliseContentTargets are caller-facing — pass through.
    if (message.startsWith('Invalid content target') || message.startsWith('contentTargets')) {
      return NextResponse.json(
        { success: false, error: message, code: 'INVALID_CONTENT_TARGETS' },
        { status: 400 },
      )
    }
    console.error('[cms/connect POST]', clientId, message)
    return NextResponse.json(
      { success: false, error: 'Failed to save connection', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
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

  const { content_targets } = body as { content_targets?: unknown }
  if (content_targets === undefined) {
    return NextResponse.json(
      { success: false, error: 'content_targets required', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }

  try {
    const status = await updateContentTargets(clientId, content_targets)
    if (!status) {
      return NextResponse.json(
        { success: false, error: 'No GitHub connection found for this client', code: 'NO_CONNECTION' },
        { status: 404 },
      )
    }
    return NextResponse.json({ success: true, data: status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.startsWith('Invalid content target') || message.startsWith('contentTargets')) {
      return NextResponse.json(
        { success: false, error: message, code: 'INVALID_CONTENT_TARGETS' },
        { status: 400 },
      )
    }
    console.error('[cms/connect PATCH]', clientId, message)
    return NextResponse.json(
      { success: false, error: 'Failed to update content targets', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'client id required', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }

  try {
    await deleteConnection(clientId)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[cms/connect DELETE]', clientId, message)
    return NextResponse.json(
      { success: false, error: 'Failed to delete connection', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}
