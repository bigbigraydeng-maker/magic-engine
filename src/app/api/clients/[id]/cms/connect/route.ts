/**
 * POST /api/clients/[id]/cms/connect
 * DELETE /api/clients/[id]/cms/connect
 *
 * POST — Save (upsert) a GitHub CMS connection for a client.
 * Body: {
 *   repo_owner:     string   // e.g. "bigbigraydeng-maker"
 *   repo_name:      string   // e.g. "chinatravel"
 *   default_branch: string?  // default "main"
 *   content_paths:  string[] // e.g. ["src/lib/data/guides.ts"]
 *   token:          string   // plain-text GitHub PAT (encrypted before storage)
 * }
 *
 * DELETE — Remove the GitHub CMS connection for a client.
 *
 * Security: requires INTERNAL_API_KEY bearer token.
 * The plain-text PAT is NEVER logged or echoed back.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBearerToken } from '@/lib/validation-utils'
import { upsertConnection, deleteConnection } from '@/lib/cms/connection-store'

interface RouteContext {
  params: { id: string }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

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

  const { repo_owner, repo_name, default_branch, content_paths, token } = body as {
    repo_owner?:     unknown
    repo_name?:      unknown
    default_branch?: unknown
    content_paths?:  unknown
    token?:          unknown
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
      plainToken:     token.trim(),
    })

    return NextResponse.json({ success: true, data: status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[cms/connect POST]', clientId, message)
    return NextResponse.json(
      { success: false, error: 'Failed to save connection', code: 'DB_ERROR' },
      { status: 500 },
    )
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: RouteContext) {
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
