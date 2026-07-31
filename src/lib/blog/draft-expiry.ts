/**
 * Blog draft auto-expiry (22.E.S18 前置 · 待办卫生).
 *
 * A draft nobody has touched for DRAFT_EXPIRY_DAYS is stale: the keyword
 * data and AI-weak-spot signal it was built on have moved on, and it only
 * clutters the PM's to-do. Auto-expire it to status='rejected' with an
 * auto_expired marker in quality_check (distinguishes it from a human
 * rejection). No content is deleted — an expired draft stays readable and
 * can be re-drafted by the weekly cron with fresh data once its topic falls
 * out of the 60-day dedup window.
 *
 * 'rejected' is an existing status CHECK value — deliberately NOT a new
 * enum member (new enum values require a migration + full frontend sync,
 * CLAUDE.md hard rule #2).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const DRAFT_EXPIRY_DAYS = 30

export interface DraftExpiryResult {
  expired: number
  titles: string[]
}

export function draftExpiryCutoff(now: Date, days: number = DRAFT_EXPIRY_DAYS): string {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - days)
  return cutoff.toISOString()
}

export async function expireStaleDrafts(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<DraftExpiryResult> {
  const cutoff = draftExpiryCutoff(now)

  // Read first: per-row jsonb merge keeps any existing quality_check content.
  const { data: stale, error: readErr } = await supabase
    .from('blog_posts')
    .select('id, title, topic, quality_check')
    .eq('status', 'draft')
    .lt('created_at', cutoff)

  if (readErr) throw new Error(`draft expiry read failed: ${readErr.message}`)

  const rows = (stale ?? []) as Array<{
    id: string
    title: string | null
    topic: string | null
    quality_check: Record<string, unknown> | null
  }>

  if (rows.length === 0) return { expired: 0, titles: [] }

  const expiredAt = now.toISOString()
  for (const row of rows) {
    const { error: updateErr } = await supabase
      .from('blog_posts')
      .update({
        status: 'rejected',
        quality_check: {
          ...(row.quality_check ?? {}),
          auto_expired: true,
          expired_at: expiredAt,
        },
      })
      .eq('id', row.id)
      .eq('status', 'draft') // guard: don't clobber a row a human just acted on

    if (updateErr) throw new Error(`draft expiry update failed: ${updateErr.message}`)
  }

  return {
    expired: rows.length,
    titles: rows.map((r) => r.title ?? r.topic ?? '(untitled)'),
  }
}
