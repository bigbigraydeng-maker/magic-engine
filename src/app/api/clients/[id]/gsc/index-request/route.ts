/**
 * POST /api/clients/[id]/gsc/index-request
 *
 * P14.B.7 — Submit a URL_UPDATED notification to Google's Indexing API so
 * the freshly published page is crawled promptly.
 *
 * Body: { url: string }
 *   url — the fully-qualified URL of the published page, e.g. https://example.com/my-post/
 *
 * Returns:
 *   { success: true, url }                          — indexing request submitted
 *   { success: false, code: 'NEEDS_REAUTH', reauth_url } — token lacks indexing scope
 *   { success: false, code: ..., error: string }    — other errors
 *
 * Security:
 *   - requireDashboardClientAccess (tenant isolation)
 *   - URL validated to be http(s) and same domain as client's GSC property
 *
 * Quota: 200 requests/day per Google Cloud project.
 * Reference: https://developers.google.com/search/apis/indexing-api/v3/quickstart
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getValidAccessToken } from '@/lib/google-oauth/client'
import { requestIndexing } from '@/lib/gsc/indexing-client'
import { buildAuthUrl, buildState } from '@/lib/google-oauth/client'
import { COMBINED_GOOGLE_SCOPES } from '@/lib/google-oauth/client'

interface RouteContext {
  params: { id: string }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return NextResponse.json(
      { success: false, error: 'url must be a valid http(s) URL', code: 'INVALID_INPUT' },
      { status: 400 },
    )
  }

  // Fetch a valid OAuth access token for this client.
  let accessToken: string
  try {
    const token = await getValidAccessToken(clientId)
    if (!token) throw new Error('No valid access token')
    accessToken = token
  } catch {
    // No OAuth connection — guide user to connect.
    const state       = buildState(clientId, 'connect')
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/auth/google/callback`
    const reauthUrl   = buildAuthUrl(state, redirectUri, COMBINED_GOOGLE_SCOPES)
    return NextResponse.json(
      { success: false, code: 'NO_OAUTH', error: 'Google account not connected — re-authorize to enable indexing requests', reauth_url: reauthUrl },
      { status: 422 },
    )
  }

  const result = await requestIndexing(url, accessToken)

  if (result.ok) {
    return NextResponse.json({ success: true, url: result.url })
  }

  // Return re-auth URL so UI can offer a direct link.
  if (result.errorCode === 'NEEDS_REAUTH') {
    const state       = buildState(clientId, 'connect')
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/auth/google/callback`
    const reauthUrl   = buildAuthUrl(state, redirectUri, COMBINED_GOOGLE_SCOPES)
    return NextResponse.json(
      { success: false, code: 'NEEDS_REAUTH', error: result.errorMsg, reauth_url: reauthUrl },
      { status: 422 },
    )
  }

  if (result.errorCode === 'QUOTA_EXCEEDED') {
    return NextResponse.json(
      { success: false, code: 'QUOTA_EXCEEDED', error: result.errorMsg },
      { status: 429 },
    )
  }

  if (result.errorCode === 'NOT_VERIFIED') {
    return NextResponse.json(
      { success: false, code: 'NOT_VERIFIED', error: result.errorMsg },
      { status: 422 },
    )
  }

  return NextResponse.json(
    { success: false, code: 'API_ERROR', error: result.errorMsg },
    { status: 502 },
  )
}
