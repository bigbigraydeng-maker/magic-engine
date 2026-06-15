/**
 * POST /api/clients/[id]/cms/wordpress/lookup-post  (P12.R.M3 — Page Rewriter UI)
 *
 * Given EITHER a WP permalink URL OR a numeric post ID + target_type, look up
 * the post and return its current state (title / slug / excerpt / Yoast meta /
 * content) so the Page Rewriter UI can show "current" vs "target" diff.
 *
 * Request body — one of:
 *   { url: "https://oztop.com.au/tile-sizes-explained/" }
 *   { post_id: 123, target_type?: "post" | "page" }
 *
 * Response:
 *   { success: true,  post: ExistingWordpressPost }
 *   { success: false, error, code: 'NOT_FOUND' | 'NO_CONNECTION' | WAF codes }
 *
 * Read-only — does NOT mutate the WP site or any ME row.
 *
 * Phase 12.R.M3
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getWordpressConnection } from '@/lib/cms/connection-store'
import {
  getExistingWordpressPost,
  findWordpressPostByUrl,
  WordpressFetchError,
  type WordpressPostType,
  type ExistingWordpressPost,
} from '@/lib/cms/wordpress-client'

interface RouteContext {
  params: { id: string }
}

interface LookupByUrlBody {
  url:        string
  post_id?:   never
  target_type?: never
}
interface LookupByIdBody {
  post_id:      number
  target_type?: WordpressPostType
  url?:         never
}
type LookupBody = LookupByUrlBody | LookupByIdBody

function badInput(msg: string): NextResponse {
  return NextResponse.json({ success: false, error: msg, code: 'INVALID_INPUT' }, { status: 400 })
}

function respondWpError(err: WordpressFetchError): NextResponse {
  const status = (() => {
    switch (err.code) {
      case 'SITEGROUND_ANTIBOT':
      case 'CLOUDFLARE_CHALLENGE':
      case 'WORDFENCE_BLOCK':
      case 'SUCURI_BLOCK':
      case 'GENERIC_WAF':
      case 'NETWORK_ERROR':
      case 'WP_REST_DISABLED':   return 502
      case 'TIMEOUT':            return 504
      case 'HTTP_ERROR':         return (err.httpStatus && err.httpStatus >= 400 && err.httpStatus < 600) ? err.httpStatus : 502
    }
  })()
  return NextResponse.json(
    { success: false, error: err.message, code: err.code, wp_status: err.httpStatus ?? null },
    { status },
  )
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    return await handleLookup(req, ctx)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[lookup-post]', ctx.params.id, message)
    return NextResponse.json(
      { success: false, error: 'Internal error processing the lookup', code: 'INTERNAL' },
      { status: 500 },
    )
  }
}

async function handleLookup(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id: clientId } = params
  if (!clientId) return badInput('client id required')

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: LookupBody
  try {
    body = await req.json() as LookupBody
  } catch {
    return badInput('Invalid JSON body')
  }

  const hasUrl = typeof body.url === 'string' && body.url.trim().length > 0
  const hasId  = typeof body.post_id === 'number' && Number.isInteger(body.post_id) && (body.post_id as number) > 0

  if (!hasUrl && !hasId) {
    return badInput('Either `url` or `post_id` is required')
  }
  if (hasUrl && hasId) {
    return badInput('Provide either `url` OR `post_id`, not both')
  }

  const targetType: WordpressPostType = body.target_type ?? 'post'
  if (targetType !== 'post' && targetType !== 'page') {
    return badInput('target_type must be "post" or "page"')
  }

  const conn = await getWordpressConnection(clientId)
  if (!conn) {
    return NextResponse.json(
      { success: false, error: 'No WordPress connection found for this client', code: 'NO_CONNECTION' },
      { status: 422 },
    )
  }
  if (conn.status !== 'connected') {
    return NextResponse.json(
      { success: false, error: 'WordPress connection is not verified', code: 'CONNECTION_NOT_VERIFIED' },
      { status: 422 },
    )
  }

  const config = {
    siteUrl:     conn.siteUrl,
    username:    conn.username,
    appPassword: conn.plainAppPassword,
  }

  try {
    let post: ExistingWordpressPost | null

    if (hasUrl) {
      // Same-host advisory: warn (don't reject) if the URL host differs from
      // the connected WP siteUrl. UI surfaces this to the FDE.
      const url      = body.url as string
      const sameHost = isSameHost(url, conn.siteUrl)
      const outcome  = await findWordpressPostByUrl(config, url)
      post = outcome.post

      if (!post) {
        return NextResponse.json(
          { success: false, error: 'No matching post or page found on this WP site for the given URL', code: 'NOT_FOUND', same_host: sameHost },
          { status: 404 },
        )
      }
      return NextResponse.json({ success: true, post, same_host: sameHost })
    } else {
      post = await getExistingWordpressPost(config, body.post_id as number, targetType)
      return NextResponse.json({ success: true, post })
    }
  } catch (err) {
    if (err instanceof WordpressFetchError) return respondWpError(err)
    throw err
  }
}

function isSameHost(url: string, siteUrl: string): boolean {
  try {
    return new URL(url).host.toLowerCase() === new URL(siteUrl).host.toLowerCase()
  } catch {
    return false
  }
}
