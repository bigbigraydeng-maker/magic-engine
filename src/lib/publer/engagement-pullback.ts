/**
 * Publer Engagement Pullback — P12.C.3
 *
 * Pulls likes / comments / shares for each published content_post that has
 * a publer_post_id, then writes them to flywheel_metrics.
 *
 * Called by POST /api/cron/social-engagement-pullback.
 *
 * Pure row-building helpers are exported for testability.
 * DB and HTTP access is in pullbackAllEngagement().
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const PUBLER_BASE = 'https://app.publer.com/api/v1'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PostEngagementData {
  likes: number
  comments: number
  shares: number
}

export interface ContentPostRow {
  id: string
  client_id: string
  flywheel_action_id: string | null
  publer_post_id: string
}

export interface MetricInsertRow {
  client_id: string
  flywheel: 'social'
  metric_key: string
  metric_value: number
  source: string
  source_ref: Record<string, string | undefined>
  measured_at: string
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function buildEngagementMetricRows(
  post: ContentPostRow,
  engagement: PostEngagementData,
): MetricInsertRow[] {
  const now = new Date().toISOString()
  const sourceRef: Record<string, string | undefined> = {
    publer_post_id: post.publer_post_id,
    content_post_id: post.id,
    ...(post.flywheel_action_id ? { flywheel_action_id: post.flywheel_action_id } : {}),
  }

  const base = {
    client_id: post.client_id,
    flywheel: 'social' as const,
    source: 'publer',
    source_ref: sourceRef,
    measured_at: now,
  }

  return [
    { ...base, metric_key: 'social.post.likes',    metric_value: engagement.likes    },
    { ...base, metric_key: 'social.post.comments', metric_value: engagement.comments },
    { ...base, metric_key: 'social.post.shares',   metric_value: engagement.shares   },
  ]
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function publerHeaders() {
  return {
    'Authorization': `Bearer-API ${process.env.PUBLER_API_KEY}`,
    'Publer-Workspace-Id': process.env.PUBLER_WORKSPACE_ID ?? '',
    'Content-Type': 'application/json',
  }
}

/**
 * Fetches engagement data for a single published Publer post.
 * Returns null if the post cannot be found or the API call fails.
 *
 * Publer GET /posts/{id} returns a post object with engagement counters.
 */
export async function fetchPostEngagement(publerPostId: string): Promise<PostEngagementData | null> {
  try {
    const res = await fetch(`${PUBLER_BASE}/posts/${publerPostId}`, {
      headers: publerHeaders(),
    })
    if (!res.ok) return null

    const data = await res.json() as Record<string, unknown>
    const post = (data.post ?? data) as Record<string, unknown>

    return {
      likes:    Number(post.like_count    ?? post.likes    ?? 0),
      comments: Number(post.comment_count ?? post.comments ?? 0),
      shares:   Number(post.share_count   ?? post.shares   ?? 0),
    }
  } catch {
    return null
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export interface PullbackResult {
  postsProcessed: number
  postsSkipped: number
  metricsWritten: number
  errors: number
}

/**
 * Main entry point.
 *
 * 1. Fetches all content_posts with a publer_post_id (status = 'published').
 * 2. For each, pulls engagement from Publer.
 * 3. Writes 3 metric rows (likes / comments / shares) to flywheel_metrics.
 */
export async function pullbackAllEngagement(
  supabase: SupabaseClient,
): Promise<PullbackResult> {
  const result: PullbackResult = { postsProcessed: 0, postsSkipped: 0, metricsWritten: 0, errors: 0 }

  const { data: posts, error } = await supabase
    .from('content_posts')
    .select('id, client_id, flywheel_action_id, publer_post_id')
    .eq('status', 'published')
    .not('publer_post_id', 'is', null)

  if (error || !posts?.length) return result

  for (const post of posts as ContentPostRow[]) {
    if (!post.publer_post_id) { result.postsSkipped++; continue }

    const engagement = await fetchPostEngagement(post.publer_post_id)
    if (!engagement) { result.postsSkipped++; continue }

    const rows = buildEngagementMetricRows(post, engagement)
    const { error: insertError } = await supabase.from('flywheel_metrics').insert(rows)
    if (insertError) {
      console.error('[engagement-pullback] insert error:', insertError.message)
      result.errors++
    } else {
      result.metricsWritten += rows.length
    }
    result.postsProcessed++
  }

  return result
}
