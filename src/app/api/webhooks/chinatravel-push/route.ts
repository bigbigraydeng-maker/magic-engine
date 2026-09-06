/**
 * POST /api/webhooks/chinatravel-push
 *
 * GitHub webhook receiver for pushes on the `chinatravel` repo.
 *
 * Why: after any data-only push to chinatravel's main branch (tour
 *   departure dates, blog copy, JSON-LD schema tweaks), the produced
 *   Render build eventually replaces the artifact but Next.js's Full
 *   Route Cache and Cloudflare's edge cache serve the previous
 *   version for up to a year. This endpoint receives the push,
 *   HMAC-verifies it, and emits a `cts_site.data.updated` event that
 *   drives the CTS site cache-refresh Inngest function (which waits
 *   for the build, revalidates the paths in Next.js, purges them in
 *   Cloudflare, and verifies).
 *
 * Configuration (one-time, in the chinatravel repo on GitHub):
 *   - Settings → Webhooks → Add webhook
 *   - Payload URL:  https://app.magicengine.com.au/api/webhooks/chinatravel-push
 *   - Content type: application/json
 *   - Secret:       $GITHUB_WEBHOOK_SECRET (same value already used by
 *                   /api/cms/github/webhook — no new secret needed)
 *   - Events:       "Just the push event"
 *
 * Non-goals: we do NOT parse the diff to figure out which specific
 *   tour or blog slug changed. planSiteRefresh() takes a conservative
 *   fan-in view of the changed file paths and lets verify smoke each
 *   published URL.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest/client'
import { planSiteRefresh } from '@/lib/site-refresh/paths'
import { CTS_SITE_DATA_UPDATED_EVENT } from '@/lib/inngest/functions/cts-site-cache-refresh'

const APPROVED_REPO = 'bigbigraydeng-maker/chinatravel'
const APPROVED_BRANCH = 'refs/heads/main'

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

interface GithubPushCommit {
  added?: unknown
  modified?: unknown
  removed?: unknown
}
interface GithubPushEvent {
  after?: unknown
  ref?: unknown
  repository?: { full_name?: unknown }
  commits?: GithubPushCommit[]
  head_commit?: GithubPushCommit
}

function collectChangedFiles(payload: GithubPushEvent): string[] {
  const files = new Set<string>()
  const push = (arr: unknown) => {
    if (!Array.isArray(arr)) return
    for (const f of arr) if (typeof f === 'string') files.add(f)
  }
  if (payload.head_commit) {
    push(payload.head_commit.added)
    push(payload.head_commit.modified)
    push(payload.head_commit.removed)
  }
  if (Array.isArray(payload.commits)) {
    for (const c of payload.commits) {
      push(c.added)
      push(c.modified)
      push(c.removed)
    }
  }
  return Array.from(files)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  const eventName = req.headers.get('x-github-event') ?? ''
  if (eventName === 'ping') return NextResponse.json({ pong: true })
  if (eventName !== 'push') {
    return NextResponse.json({ ignored: `event:${eventName}` })
  }

  let parsed: GithubPushEvent
  try {
    parsed = JSON.parse(rawBody) as GithubPushEvent
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const repoName = typeof parsed.repository?.full_name === 'string' ? parsed.repository.full_name : ''
  if (repoName !== APPROVED_REPO) {
    return NextResponse.json({ ignored: `repo:${repoName || 'unknown'}` })
  }

  const ref = typeof parsed.ref === 'string' ? parsed.ref : ''
  if (ref !== APPROVED_BRANCH) {
    return NextResponse.json({ ignored: `ref:${ref || 'unknown'}` })
  }

  const commitSha = typeof parsed.after === 'string' ? parsed.after : ''
  const changedFiles = collectChangedFiles(parsed)
  const plan = planSiteRefresh(changedFiles)

  if (!plan.hasSiteChange) {
    return NextResponse.json({
      accepted: true,
      dispatched: false,
      reason: 'no_site_change',
      commit_sha: commitSha,
      changed_file_count: changedFiles.length,
    })
  }

  await inngest.send({
    name: CTS_SITE_DATA_UPDATED_EVENT,
    data: {
      commit_sha: commitSha,
      ref,
      changed_files: changedFiles,
      triggered_at_ms: Date.now(),
    },
  })

  return NextResponse.json({
    accepted: true,
    dispatched: true,
    event: CTS_SITE_DATA_UPDATED_EVENT,
    commit_sha: commitSha,
    tour_data_changed: plan.tourDataChanged,
    blog_data_changed: plan.blogDataChanged,
    plan_reasons: plan.reasons,
  })
}
