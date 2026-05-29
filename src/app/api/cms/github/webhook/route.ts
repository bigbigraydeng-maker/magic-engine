/**
 * POST /api/cms/github/webhook
 *
 * GitHub webhook receiver for pull_request events.
 *
 * Why this exists:
 *   blog-publisher opens a PR for every CTS Tours blog post but stops there.
 *   PM had to manually merge the PR, then manually press "🔍 请求 Google 收录"
 *   in ME. That meant 5 blogs/week × 2 round-trips to GitHub + ME per blog =
 *   bottleneck for the CTS pipeline.
 *
 * This route closes the loop:
 *   1. Validate the HMAC signature (X-Hub-Signature-256).
 *   2. On pull_request.closed with merged=true, look up the blog_post
 *      by pr_number + verify pr_url matches (avoids cross-client collision).
 *   3. Flip status='published' and set published_at = NOW().
 *   4. Best-effort: request GSC indexing using the client's OAuth token.
 *
 * Configuration (per GitHub repo, one-time):
 *   - Settings → Webhooks → Add webhook
 *   - Payload URL: https://${RENDER_EXTERNAL_URL}/api/cms/github/webhook
 *   - Content type: application/json
 *   - Secret: same value as GITHUB_WEBHOOK_SECRET env var
 *   - Events: "Pull requests" only
 *
 * Reference: ROADMAP.md P14.C.6
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getValidAccessToken } from '@/lib/google-oauth/client'
import { requestIndexing } from '@/lib/gsc/indexing-client'
import { pingSitemap, buildSitemapUrlFromDomain, type SitemapPingSummary } from '@/lib/gsc/sitemap-ping'

interface GithubPullRequestEvent {
  action: string
  pull_request: {
    number: number
    html_url: string
    merged: boolean
    merged_at: string | null
  }
  repository: {
    full_name: string
  }
}

interface BlogPostRow {
  id:         string
  client_id:  string
  slug:       string | null
  pr_url:     string | null
  pr_number:  number | null
  status:     string
}

interface ClientRow {
  domain: string | null
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) return false
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const provided = signatureHeader.slice('sha256='.length)
  if (expected.length !== provided.length) return false

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // GitHub sends the body once. We need the raw text for HMAC verification.
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'unreadable body' }, { status: 400 })
  }

  const sig = req.headers.get('x-hub-signature-256')
  if (!verifySignature(rawBody, sig)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const event = req.headers.get('x-github-event') ?? ''
  // Always return 200 for events we choose to ignore — GitHub disables webhooks
  // that return many non-2xx responses.
  if (event === 'ping') {
    return NextResponse.json({ pong: true })
  }
  if (event !== 'pull_request') {
    return NextResponse.json({ ignored: `event=${event}` })
  }

  let body: GithubPullRequestEvent
  try {
    body = JSON.parse(rawBody) as GithubPullRequestEvent
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  if (body.action !== 'closed' || !body.pull_request?.merged) {
    return NextResponse.json({ ignored: 'not a merge' })
  }

  // ── Lookup the blog_post ─────────────────────────────────────────────────
  // pr_number is not globally unique, so we also match the full pr_url.
  const { data: posts, error: lookupErr } = await supabaseAdmin
    .from('blog_posts')
    .select('id, client_id, slug, pr_url, pr_number, status')
    .eq('pr_number', body.pull_request.number)

  if (lookupErr) {
    console.error('[github-webhook] blog_posts lookup failed', lookupErr)
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  }

  const match = (posts ?? []).find(
    p => (p as BlogPostRow).pr_url === body.pull_request.html_url,
  ) as BlogPostRow | undefined

  if (!match) {
    // PR merged but no ME-tracked blog_post — could be a non-ME PR. Acknowledge silently.
    return NextResponse.json({ ignored: 'no matching blog_post' })
  }

  // ── Update blog_post → published ─────────────────────────────────────────
  const publishedAt = body.pull_request.merged_at ?? new Date().toISOString()
  const { error: updateErr } = await supabaseAdmin
    .from('blog_posts')
    .update({ status: 'published', published_at: publishedAt })
    .eq('id', match.id)

  if (updateErr) {
    console.error('[github-webhook] blog_posts update failed', updateErr)
    return NextResponse.json({ error: 'update failed' }, { status: 500 })
  }

  // ── Best-effort downstream signals ─────────────────────────────────────
  // All failures are swallowed — GitHub disables receivers that don't 2xx promptly.
  //
  //   1. Sitemap ping (Google + Bing) — the practical lever to get the
  //      sitemap re-fetched and the new URL discovered. Works for any
  //      content type. See sitemap-ping.ts for protocol caveats.
  //   2. GSC Indexing API — kept around for JobPosting / BroadcastEvent
  //      content. Will report NOT_SUPPORTED_BY_API for blog URLs (Google
  //      drops the request silently at the backend); the UI surfaces the
  //      classification and recommends the manual GSC Inspect fallback.
  const [sitemapResult, gscResult] = await Promise.all([
    tryPingSitemap(match.client_id),
    tryRequestGscIndexing(match.client_id, match.slug),
  ])

  return NextResponse.json({
    success:        true,
    blog_post_id:   match.id,
    pr_number:      body.pull_request.number,
    published_at:   publishedAt,
    sitemap_ping:   sitemapResult,
    gsc_indexing:   gscResult,
  })
}

async function tryPingSitemap(clientId: string): Promise<SitemapPingSummary | { attempted: false; reason: string }> {
  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('domain')
    .eq('id', clientId)
    .maybeSingle<ClientRow>()
  const sitemapUrl = buildSitemapUrlFromDomain(clientRow?.domain)
  if (!sitemapUrl) return { attempted: false, reason: 'no client domain' }
  try {
    return await pingSitemap(sitemapUrl)
  } catch (err) {
    return {
      attempted: false,
      reason: err instanceof Error ? err.message : 'sitemap ping threw unexpectedly',
    }
  }
}

interface GscResult {
  attempted: boolean
  ok?:       boolean
  reason?:   string
  url?:      string
}

async function tryRequestGscIndexing(clientId: string, slug: string | null): Promise<GscResult> {
  if (!slug) return { attempted: false, reason: 'no slug' }

  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('domain')
    .eq('id', clientId)
    .maybeSingle<ClientRow>()

  const domain = clientRow?.domain?.trim()
  if (!domain) return { attempted: false, reason: 'no client domain' }

  const base = domain.startsWith('http') ? domain : `https://${domain}`
  const url  = `${base.replace(/\/$/, '')}/blog/${slug}`

  let token: string | null
  try {
    token = await getValidAccessToken(clientId)
  } catch {
    return { attempted: true, ok: false, reason: 'no oauth token', url }
  }
  if (!token) return { attempted: true, ok: false, reason: 'no oauth token', url }

  try {
    const result = await requestIndexing(url, token)
    return { attempted: true, ok: result.ok, reason: result.ok ? undefined : result.errorMsg, url }
  } catch (err) {
    return {
      attempted: true,
      ok:        false,
      reason:    err instanceof Error ? err.message : 'gsc call failed',
      url,
    }
  }
}
