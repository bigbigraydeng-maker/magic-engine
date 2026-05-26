/**
 * GET /api/clients/[id]/gsc/sites
 *
 * Returns the list of GSC properties the client's authorised Google account
 * can access. Powers the connector UI dropdown so operators don't have to
 * hand-type the site_url (and risk URL-prefix vs sc-domain mismatch).
 *
 * Returns: { success, sites: Array<{ siteUrl, permissionLevel }> }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P17.A.followup
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBearerToken } from '@/lib/validation-utils'
import { getValidAccessToken } from '@/lib/google-oauth/client'

export const dynamic = 'force-dynamic'

const SITES_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites'
const FETCH_TIMEOUT_MS = 15_000

interface SiteEntry {
  siteUrl:         string
  permissionLevel: string
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { id: clientId } = params

  const token = await getValidAccessToken(clientId)
  if (!token) {
    return NextResponse.json(
      { success: false, error: 'No valid Google OAuth token — complete OAuth first.' },
      { status: 422 },
    )
  }

  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(SITES_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  controller.signal,
    })

    if (!res.ok) {
      const body = await res.text()
      console.warn(`[gsc/sites] list returned ${res.status}: ${body.slice(0, 200)}`)
      return NextResponse.json(
        { success: false, error: `Google API returned ${res.status}`, detail: body.slice(0, 500) },
        { status: 502 },
      )
    }

    const data = await res.json() as { siteEntry?: SiteEntry[] }
    const sites = (data.siteEntry ?? []).filter(s => s.siteUrl && s.permissionLevel)

    return NextResponse.json({ success: true, sites })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[gsc/sites] fetch failed:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  } finally {
    clearTimeout(timer)
  }
}
