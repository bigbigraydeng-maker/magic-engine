/**
 * FB Page metrics rollup (2026-08-01 · 社媒数据监控复活).
 *
 * The Publer engagement pullback had run for weeks writing ZERO metrics:
 * it only reads content_posts rows, but real posting happens straight on
 * the Facebook page (manual Publer line) and never lands there. Meanwhile
 * the comment-autoreply engine reads the SAME page's real posts daily via
 * the Graph API — proof the read path works.
 *
 * This module rolls that read path into daily account-level metrics:
 *   social.fb.posts_7d / reactions_7d / comments_7d / shares_7d
 *   social.fb.days_since_last_post   (断更监控 — the weekly report's
 *   "社媒栏" and streak alerts read these)
 *   social.fb.top_post_score         (best-performer signal)
 *
 * Source of truth = the live page feed, so posts published by ANY channel
 * (Publer, Business Suite, by hand) all count. Per-post attribution stays
 * with the Publer pullback for ME-scheduled posts.
 *
 * Page mapping: social_comment_config.fb_page_id (same table the autoreply
 * engine trusts), falling back to factory_config.publish_target.page_id.
 * Only active clients run (真客户闸门, cost gate 阶段 0).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken, fetchPagePosts, type PagePost } from '@/lib/meta/page-posts'

const POSTS_TO_FETCH = 50

export interface SocialRollup {
  posts_7d: number
  reactions_7d: number
  comments_7d: number
  shares_7d: number
  days_since_last_post: number | null
  top_post_score: number
}

export interface PageMetricsClientResult {
  client_id: string
  page_id: string
  outcome: 'synced' | 'no_token' | 'error'
  posts_seen?: number
  error?: string
}

export interface PageMetricsSyncResult {
  clients: number
  synced: number
  results: PageMetricsClientResult[]
}

// ── Pure rollup ─────────────────────────────────────────────────────────────────

export function computeSocialRollup(posts: PagePost[], now: Date = new Date()): SocialRollup {
  const weekAgo = now.getTime() - 7 * 86_400_000

  let posts7d = 0
  let reactions7d = 0
  let comments7d = 0
  let shares7d = 0
  let newestPost: number | null = null
  let topScore = 0

  for (const post of posts) {
    const t = Date.parse(post.createdAt)
    if (Number.isNaN(t)) continue

    if (newestPost === null || t > newestPost) newestPost = t
    if (post.score > topScore) topScore = post.score

    if (t >= weekAgo) {
      posts7d += 1
      reactions7d += post.reactions
      comments7d += post.comments
      shares7d += post.shares
    }
  }

  return {
    posts_7d: posts7d,
    reactions_7d: reactions7d,
    comments_7d: comments7d,
    shares_7d: shares7d,
    days_since_last_post:
      newestPost === null ? null : Math.floor((now.getTime() - newestPost) / 86_400_000),
    top_post_score: topScore,
  }
}

// ── Page mapping ────────────────────────────────────────────────────────────────

interface PageMapping {
  client_id: string
  page_id: string
}

export async function loadPageMappings(supabase: SupabaseClient): Promise<PageMapping[]> {
  const [{ data: active, error: activeErr }, { data: commentCfg }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, factory_config')
      .eq('client_status', 'active'),
    supabase.from('social_comment_config').select('client_id, fb_page_id'),
  ])
  if (activeErr) throw new Error(`active clients load failed: ${activeErr.message}`)

  const activeRows = (active ?? []) as Array<{
    id: string
    factory_config: { publish_target?: { platform?: string; page_id?: string } } | null
  }>
  const activeIds = new Set(activeRows.map((c) => c.id))

  const byClient = new Map<string, string>()

  // Primary: the autoreply config (already trusted to hold real page ids).
  for (const row of (commentCfg ?? []) as Array<{ client_id: string; fb_page_id: string | null }>) {
    if (row.fb_page_id && activeIds.has(row.client_id)) {
      byClient.set(row.client_id, row.fb_page_id)
    }
  }

  // Fallback: video-factory publish target.
  for (const client of activeRows) {
    if (byClient.has(client.id)) continue
    const target = client.factory_config?.publish_target
    if (target?.platform === 'facebook' && target.page_id) {
      byClient.set(client.id, target.page_id)
    }
  }

  return Array.from(byClient.entries()).map(([client_id, page_id]) => ({ client_id, page_id }))
}

// ── Sync ────────────────────────────────────────────────────────────────────────

export async function syncPageMetrics(
  supabase: SupabaseClient = supabaseAdmin,
): Promise<PageMetricsSyncResult> {
  const mappings = await loadPageMappings(supabase)
  const results: PageMetricsClientResult[] = []

  for (const { client_id, page_id } of mappings) {
    try {
      const userToken = await getMetaTokenForClient(client_id)
      if (!userToken) {
        results.push({ client_id, page_id, outcome: 'no_token' })
        continue
      }
      const pageToken = await getPageAccessToken(userToken, page_id)
      if (!pageToken) {
        results.push({ client_id, page_id, outcome: 'no_token' })
        continue
      }

      const posts = await fetchPagePosts(page_id, pageToken, POSTS_TO_FETCH)
      const rollup = computeSocialRollup(posts)

      const measuredAt = new Date().toISOString()
      const base = {
        client_id,
        flywheel: 'social' as const,
        source: 'meta_page',
        source_ref: { fb_page_id: page_id },
        measured_at: measuredAt,
      }
      const rows = [
        { ...base, metric_key: 'social.fb.posts_7d', metric_value: rollup.posts_7d },
        { ...base, metric_key: 'social.fb.reactions_7d', metric_value: rollup.reactions_7d },
        { ...base, metric_key: 'social.fb.comments_7d', metric_value: rollup.comments_7d },
        { ...base, metric_key: 'social.fb.shares_7d', metric_value: rollup.shares_7d },
        { ...base, metric_key: 'social.fb.top_post_score', metric_value: rollup.top_post_score },
        ...(rollup.days_since_last_post !== null
          ? [{ ...base, metric_key: 'social.fb.days_since_last_post', metric_value: rollup.days_since_last_post }]
          : []),
      ]

      const { error: insertErr } = await supabase.from('flywheel_metrics').insert(rows)
      if (insertErr) throw new Error(insertErr.message)

      results.push({ client_id, page_id, outcome: 'synced', posts_seen: posts.length })
    } catch (err) {
      results.push({
        client_id,
        page_id,
        outcome: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    clients: results.length,
    synced: results.filter((r) => r.outcome === 'synced').length,
    results,
  }
}
