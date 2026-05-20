/**
 * POST /api/clients/[id]/cms/test
 *
 * Test the saved GitHub CMS connection by calling the GitHub API with the
 * stored (decrypted) PAT. Checks that the repo exists and is accessible.
 *
 * Updates the cms_connections row with the test result (status + last_tested_at).
 *
 * Security: requires INTERNAL_API_KEY bearer token.
 * The PAT is decrypted server-side and used only for the GitHub API call —
 * it is NEVER included in any response or log.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBearerToken } from '@/lib/validation-utils'
import { getConnection, markConnectionTested } from '@/lib/cms/connection-store'
import { GithubClient, GitHubApiError } from '@/lib/cms/github-client'

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

  // 1. Load connection (with decrypted PAT)
  let conn: Awaited<ReturnType<typeof getConnection>>
  try {
    conn = await getConnection(clientId)
  } catch (err) {
    console.error('[cms/test] getConnection error', clientId, err instanceof Error ? err.message : err)
    return NextResponse.json(
      { success: false, error: 'Failed to load connection', code: 'DB_ERROR' },
      { status: 500 },
    )
  }

  if (!conn) {
    return NextResponse.json(
      { success: false, error: 'No CMS connection configured for this client', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  // 2. Call GitHub API — PAT never logged, never in response
  const client = new GithubClient(conn.plainToken)
  let repoFullName: string
  try {
    const repo  = await client.getRepo(conn.repoOwner, conn.repoName)
    repoFullName = repo.full_name
  } catch (err) {
    const errorMessage = err instanceof GitHubApiError
      ? `GitHub ${err.status}: ${err.message.replace(/ghp_[A-Za-z0-9]+/g, '[REDACTED]')}`
      : 'GitHub API unreachable'

    console.error('[cms/test] GitHub call failed', clientId, err instanceof Error ? err.message : err)

    try {
      await markConnectionTested(clientId, false, errorMessage)
    } catch { /* non-fatal */ }

    return NextResponse.json(
      { success: false, error: errorMessage, code: 'GITHUB_API_ERROR' },
      { status: 422 },
    )
  }

  // 3. Mark as connected
  let updated: Awaited<ReturnType<typeof markConnectionTested>>
  try {
    updated = await markConnectionTested(clientId, true)
  } catch {
    // non-fatal — return success even if status update fails
    updated = null
  }

  return NextResponse.json({
    success: true,
    data: {
      repo:   repoFullName,
      status: updated ?? conn,
    },
  })
}
