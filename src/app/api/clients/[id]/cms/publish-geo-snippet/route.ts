/**
 * POST /api/clients/[id]/cms/publish-geo-snippet
 *
 * Deploy the active GEO directive snippet to the client's connected CMS.
 * Creates a dedicated hidden page on the CMS containing the GEO directive
 * HTML block, then records the deployment in geo_directives.deployed_pages.
 *
 * Body:
 *   { provider: 'wordpress' | 'shopify' }
 *
 * Response:
 *   { success: true, published_url: string, provider: string }
 *
 * Reuses wordpress-client / shopify-client publish functions (same crypto
 * and CMS connection path as publish-wordpress / publish-shopify routes).
 *
 * Security: requireDashboardClientAccess (session-cookie auth)
 * Reference: ROADMAP.md P24.C
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getWordpressConnection, getShopifyConnection } from '@/lib/cms/connection-store'
import {
  createWordpressPageDraft,
  publishWordpressPage,
} from '@/lib/cms/wordpress-client'
import {
  createShopifyPageDraft,
  publishShopifyPage,
} from '@/lib/cms/shopify-client'
import { prepareCmsContent } from '@/lib/cms/html-sanitizer'
import { generateDirectiveHtml } from '@/lib/geo/html-generator'
import type { GeoDirective } from '@/types/magic-engine'

interface RouteContext {
  params: { id: string }
}

const GEO_PAGE_TITLE = 'GEO Directive (Magic Engine)'

function badInput(msg: string) {
  return NextResponse.json({ success: false, error: msg, code: 'INVALID_INPUT' }, { status: 400 })
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: { provider?: string }
  try {
    body = (await req.json()) as { provider?: string }
  } catch {
    return badInput('Invalid JSON body')
  }

  const provider = body.provider
  if (provider !== 'wordpress' && provider !== 'shopify') {
    return badInput('provider must be "wordpress" or "shopify"')
  }

  // Fetch the active GEO directive
  const { data: directiveRow, error: dirErr } = await supabaseAdmin
    .from('geo_directives')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle()

  if (dirErr) {
    return NextResponse.json(
      { success: false, error: `Failed to fetch GEO directive: ${dirErr.message}` },
      { status: 500 },
    )
  }
  if (!directiveRow) {
    return NextResponse.json(
      { success: false, error: 'No active GEO directive found. Create one first.', code: 'NO_DIRECTIVE' },
      { status: 404 },
    )
  }

  const directive = directiveRow as GeoDirective
  const snippetHtml = generateDirectiveHtml(directive)
  const safeContent = prepareCmsContent(snippetHtml)

  try {
    let publishedUrl: string

    if (provider === 'wordpress') {
      publishedUrl = await publishToWordpress(clientId, safeContent)
    } else {
      publishedUrl = await publishToShopify(clientId, safeContent)
    }

    // Record the deployment in geo_directives.deployed_pages
    await recordDeployment(clientId, directive.id, publishedUrl)

    return NextResponse.json({ success: true, published_url: publishedUrl, provider })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const code    = (err as Record<string, unknown>).code as string | undefined
    console.error('[publish-geo-snippet]', clientId, provider, message)

    if (code === 'NO_CONNECTION' || code === 'CONNECTION_NOT_VERIFIED') {
      return NextResponse.json({ success: false, error: message, code }, { status: 422 })
    }
    if (message.includes('authenticate') || message.includes('decrypt')) {
      return NextResponse.json(
        { success: false, error: 'CMS credential error — re-enter credentials in Settings.', code: 'DECRYPT_ERROR' },
        { status: 422 },
      )
    }
    return NextResponse.json({ success: false, error: message, code: 'INTERNAL' }, { status: 500 })
  }
}

async function publishToWordpress(clientId: string, content: string): Promise<string> {
  const conn = await getWordpressConnection(clientId)
  if (!conn) {
    throw Object.assign(new Error('No WordPress connection found'), { code: 'NO_CONNECTION' })
  }
  if (conn.status !== 'connected') {
    throw Object.assign(new Error('WordPress connection is not verified'), { code: 'CONNECTION_NOT_VERIFIED' })
  }

  const config = { siteUrl: conn.siteUrl, username: conn.username, appPassword: conn.plainAppPassword }

  const draft = await createWordpressPageDraft(config, {
    title:   GEO_PAGE_TITLE,
    content,
    excerpt: 'GEO directive snippet page — managed by Magic Engine.',
  })

  await publishWordpressPage(config, draft.platformId)
  return draft.previewUrl
}

async function publishToShopify(clientId: string, content: string): Promise<string> {
  const conn = await getShopifyConnection(clientId)
  if (!conn) {
    throw Object.assign(new Error('No Shopify connection found'), { code: 'NO_CONNECTION' })
  }
  if (conn.status !== 'connected') {
    throw Object.assign(new Error('Shopify connection is not verified'), { code: 'CONNECTION_NOT_VERIFIED' })
  }

  const config = { shopUrl: conn.shopUrl, accessToken: conn.plainToken }

  const draft = await createShopifyPageDraft(config, {
    title:    GEO_PAGE_TITLE,
    bodyHtml: content,
  })

  await publishShopifyPage(config, draft.platformId)
  return draft.previewUrl
}

async function recordDeployment(clientId: string, directiveId: string, url: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('geo_directives')
    .select('deployed_pages')
    .eq('id', directiveId)
    .eq('client_id', clientId)
    .maybeSingle()

  const pages: string[] = (existing as { deployed_pages: string[] | null } | null)?.deployed_pages ?? []
  if (!pages.includes(url)) {
    pages.push(url)
    await supabaseAdmin
      .from('geo_directives')
      .update({ deployed_pages: pages })
      .eq('id', directiveId)
      .eq('client_id', clientId)
  }
}
