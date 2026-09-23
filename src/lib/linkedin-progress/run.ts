/**
 * Shared implementation for the two linkedin-progress-post cron routes
 * (Monday + Thursday). Split into two physical routes — each with its own
 * literal startCronRun string argument in its own route.ts — rather than one
 * route with a computed job name, so each weekday is independently visible
 * in cron_run_logs and to the CRON_REGISTRY health check (see
 * src/lib/cron/registry.test.ts, which statically greps each route file for
 * that literal argument).
 *
 * Turns this week's shipped CHANGELOG.md entries into one English LinkedIn
 * post and publishes it, fully unattended, to the founder's personal
 * LinkedIn (via the existing content_posts → Publer pipeline, piggybacked on
 * the Magic Lab Class client record).
 *
 * Ships dark: no-ops unless LINKEDIN_PROGRESS_POST_ENABLED=true (PM turns it
 * on after connecting the LinkedIn account in Publer and binding it on the
 * Magic Lab Class connectors page).
 *
 * Three things never auto-publish, even when the switch is on — they land as a
 * 'draft' content_post instead and surface through the PM-todo manual-item
 * pipeline (see src/lib/pm-todo/manual-items.ts):
 *   1. The LinkedIn account isn't bound yet (one-time setup not done).
 *   2. The sensitive-content backstop trips on the source material or the
 *      LLM's own draft (CHANGELOG.md genuinely contains real client names
 *      and operational numbers — see sensitive-filter.ts).
 *   3. The pre-publish content guard flags the draft (src/lib/content/content-guard.ts).
 *      This is the only fully unattended publish path in the product — nobody
 *      ever reads the post before it goes out — and the source material is
 *      Chinese while the post must be English, which is exactly the
 *      mixed-language leak the deterministic half of the guard catches.
 *
 * No "already posted" state is stored — dedupe is a lookback query on
 * content_posts itself, and the changelog window is derived from NZ weekday,
 * not from a stored pointer. See changelog-window.ts for why.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { CronRunHandle } from '@/lib/cron/run-logger'
import { scheduleSocialPost, resolveBoundPublerAccount } from '@/lib/flywheel/social-post-publish'
import { loadChangelogWindow, nzDateString } from './changelog-window'
import { draftLinkedinPost, validateDraftFormat } from './draft-post'
import { loadClientKeywords, findSensitiveMatches } from './sensitive-filter'
import { runContentGuard, contentGuardSnapshot } from '@/lib/content/content-guard'
import { LINKEDIN_PROGRESS_CLIENT_ID, LINKEDIN_PROGRESS_SOURCE, LINKEDIN_PROGRESS_PLATFORM } from './constants'

/** How far back the dedupe check looks for an already-created post this window. */
/**
 * Dedupe lookback for "did this fire already run". Deliberately much shorter
 * than the 3–4 day gap between the two real cron fires (Mon→Thu is exactly 3
 * days) — a window sized to match that gap would make the Thursday run see
 * Monday's post as "already posted" and silently no-op every single week.
 * This only needs to catch genuine duplicate fires (retry, overlapping
 * deploy, a manual test curl) of the SAME scheduled run.
 */
const DEDUPE_LOOKBACK_HOURS = 20

interface GenerationSnapshot {
  cutoff_date: string
  changelog_dates: string[]
  entry_count: number
  flagged_terms: string[]
  format_violations: string[]
  /** Pre-publish guard receipt — same shape every other generator writes. */
  content_guard: Record<string, unknown>
  reason?:
    | 'sensitive_content_flagged'
    | 'format_violation'
    | 'content_guard_flagged'
    | 'linkedin_account_not_configured'
    | 'publish_failed'
    | 'published_but_db_sync_failed'
  publish_error?: string
}

export async function runLinkedinProgressPost(cronRun: CronRunHandle, now: Date = new Date()): Promise<NextResponse> {
  if (process.env.LINKEDIN_PROGRESS_POST_ENABLED !== 'true') {
    await cronRun.finish({ summary: { skipped: 'disabled' } })
    return NextResponse.json({ ok: true, skipped: 'disabled' })
  }

  try {
    // 1. Dedupe — a duplicate fire (retry, overlapping deploy, manual test
    //    curl) must not produce a second post for the same window.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('content_posts')
      .select('id')
      .eq('client_id', LINKEDIN_PROGRESS_CLIENT_ID)
      .eq('source', LINKEDIN_PROGRESS_SOURCE)
      .gte('created_at', new Date(now.getTime() - DEDUPE_LOOKBACK_HOURS * 3_600_000).toISOString())
      .limit(1)
    if (existingErr) throw new Error(`dedupe check failed: ${existingErr.message}`)
    if (existing && existing.length > 0) {
      await cronRun.finish({ summary: { skipped: 'already_posted_this_window' } })
      return NextResponse.json({ ok: true, skipped: 'already_posted_this_window' })
    }

    // 2. This week's shipped work
    const { cutoffDate, entries } = await loadChangelogWindow(now)
    if (entries.length === 0) {
      await cronRun.finish({ summary: { skipped: 'no_new_entries', cutoffDate } })
      return NextResponse.json({ ok: true, skipped: 'no_new_entries', cutoffDate })
    }

    // 3. Draft + two code-level backstops on the LLM's own output — a clean
    //    prompt can still leak a client detail it was told to omit, or drift
    //    on length/hashtags/markdown on an off week. Either backstop routes
    //    to human review instead of auto-publishing.
    const clientKeywords = await loadClientKeywords()
    const sourceText = entries.map((e) => `${e.heading}\n${e.body}`).join('\n\n')
    const caption = await draftLinkedinPost(entries)
    if (!caption) throw new Error('LLM returned an empty draft')

    const matches = [
      ...findSensitiveMatches(sourceText, clientKeywords),
      ...findSensitiveMatches(caption, clientKeywords),
    ]
    const flaggedTerms = Array.from(new Set(matches.map((m) => `${m.kind}:${m.term}`)))
    const formatViolations = validateDraftFormat(caption)
    // Third backstop. Never throws; a judge outage resolves to
    // needsHumanReview, which routes to draft rather than auto-publishing —
    // the right trade on a path where no human is watching.
    const guard = await runContentGuard(caption, { targetLanguage: 'en' })

    const baseSnapshot: GenerationSnapshot = {
      cutoff_date: cutoffDate,
      changelog_dates: Array.from(new Set(entries.map((e) => e.date))),
      entry_count: entries.length,
      flagged_terms: flaggedTerms,
      format_violations: formatViolations.map((v) => `${v.rule}:${v.detail}`),
      content_guard: contentGuardSnapshot(guard),
    }

    const title = `ME product update — ${nzDateString(now)}`

    if (flaggedTerms.length > 0 || formatViolations.length > 0 || guard.needsHumanReview) {
      const reason =
        flaggedTerms.length > 0 ? 'sensitive_content_flagged'
        : formatViolations.length > 0 ? 'format_violation'
        : 'content_guard_flagged'
      const { error: insertErr } = await supabaseAdmin.from('content_posts').insert({
        client_id: LINKEDIN_PROGRESS_CLIENT_ID,
        title: `${title} (needs review)`,
        route: 'route_c',
        platforms: [LINKEDIN_PROGRESS_PLATFORM],
        caption,
        source: LINKEDIN_PROGRESS_SOURCE,
        status: 'draft',
        generation_context_snapshot: { ...baseSnapshot, reason },
      })
      if (insertErr) throw new Error(`content_posts insert failed: ${insertErr.message}`)

      await cronRun.finish({
        summary: {
          flagged: flaggedTerms.length > 0,
          formatInvalid: formatViolations.length > 0,
          guardFlagged: guard.needsHumanReview,
          guardStatus: guard.status,
          terms: flaggedTerms,
        },
      })
      return NextResponse.json({
        ok: true,
        flagged: flaggedTerms.length > 0,
        formatInvalid: formatViolations.length > 0,
        guardFlagged: guard.needsHumanReview,
        terms: flaggedTerms,
      })
    }

    // 4. Resolve the LinkedIn account strictly — never fall back to "any
    //    connected account" (scheduleSocialPost has a fallback branch for
    //    that; we deliberately never let this flow reach it by verifying the
    //    binding ourselves first).
    const boundAccount = await resolveBoundPublerAccount(LINKEDIN_PROGRESS_CLIENT_ID, LINKEDIN_PROGRESS_PLATFORM)

    if (!boundAccount) {
      const { error: insertErr } = await supabaseAdmin.from('content_posts').insert({
        client_id: LINKEDIN_PROGRESS_CLIENT_ID,
        title: `${title} (needs LinkedIn account setup)`,
        route: 'route_c',
        platforms: [LINKEDIN_PROGRESS_PLATFORM],
        caption,
        source: LINKEDIN_PROGRESS_SOURCE,
        status: 'draft',
        generation_context_snapshot: { ...baseSnapshot, reason: 'linkedin_account_not_configured' },
      })
      if (insertErr) throw new Error(`content_posts insert failed: ${insertErr.message}`)

      await cronRun.finish({ summary: { skipped: 'linkedin_account_not_configured' } })
      return NextResponse.json({ ok: true, skipped: 'linkedin_account_not_configured' })
    }

    // 5. Clean + account verified — publish for real.
    //
    // Re-check dedupe immediately before this insert (not just the coarse
    // check in step 1). This does NOT make the check-then-insert atomic —
    // that needs a DB unique constraint, which is a migration and out of
    // scope for this pass — but it collapses the race window from "the
    // entire function, including an LLM call" down to two adjacent queries,
    // which is what actually matters for the realistic case (a manual test
    // curl overlapping a real cron fire), not a theoretical guarantee.
    const { data: raceCheck, error: raceCheckErr } = await supabaseAdmin
      .from('content_posts')
      .select('id')
      .eq('client_id', LINKEDIN_PROGRESS_CLIENT_ID)
      .eq('source', LINKEDIN_PROGRESS_SOURCE)
      .gte('created_at', new Date(now.getTime() - DEDUPE_LOOKBACK_HOURS * 3_600_000).toISOString())
      .limit(1)
    if (raceCheckErr) throw new Error(`dedupe re-check failed: ${raceCheckErr.message}`)
    if (raceCheck && raceCheck.length > 0) {
      await cronRun.finish({ summary: { skipped: 'already_posted_this_window' } })
      return NextResponse.json({ ok: true, skipped: 'already_posted_this_window' })
    }

    const { data: post, error: insertErr } = await supabaseAdmin
      .from('content_posts')
      .insert({
        client_id: LINKEDIN_PROGRESS_CLIENT_ID,
        title,
        route: 'route_c',
        platforms: [LINKEDIN_PROGRESS_PLATFORM],
        caption,
        source: LINKEDIN_PROGRESS_SOURCE,
        status: 'approved',
        generation_context_snapshot: baseSnapshot,
      })
      .select('id')
      .single()
    if (insertErr || !post) throw new Error(`content_posts insert failed: ${insertErr?.message ?? 'no row'}`)

    // Pass the already strictly-verified account through — scheduleSocialPost's
    // own internal resolution is looser (falls back to "any connected
    // account" on a stale/ambiguous binding) and must not be allowed to
    // re-resolve to a different account than the one just verified above.
    const result = await scheduleSocialPost({
      postId: post.id,
      clientId: LINKEDIN_PROGRESS_CLIENT_ID,
      account: boundAccount,
    })
    if (!result.ok) {
      const { error: snapshotUpdateErr } = await supabaseAdmin
        .from('content_posts')
        .update({
          generation_context_snapshot: {
            ...baseSnapshot,
            reason: 'publish_failed',
            publish_error: result.error,
          } satisfies GenerationSnapshot,
        })
        .eq('id', post.id)
      if (snapshotUpdateErr) {
        console.error(
          '[runLinkedinProgressPost] failed to record publish_error on content_posts:',
          snapshotUpdateErr.message,
        )
      }
      throw new Error(`scheduleSocialPost failed: ${result.error}`)
    }

    if (result.dbSyncError) {
      // Publer already has this post live/queued — content_posts just
      // doesn't know it yet. Best-effort mark this distinctly (separate
      // write attempt, since the status/publer_post_id write is what just
      // failed) so the manual-item check below never mistakes this for
      // "failed to publish" and tells someone to retry — that would publish
      // a real duplicate. If this write also fails, the console.error in
      // scheduleSocialPost (with postId + publerJobId) is the fallback trail.
      const { error: reconcileErr } = await supabaseAdmin
        .from('content_posts')
        .update({
          generation_context_snapshot: {
            ...baseSnapshot,
            reason: 'published_but_db_sync_failed',
            publish_error: result.dbSyncError,
          } satisfies GenerationSnapshot,
        })
        .eq('id', post.id)
      if (reconcileErr) {
        console.error(
          '[runLinkedinProgressPost] failed to record published_but_db_sync_failed marker:',
          reconcileErr.message,
        )
      }
    }

    await cronRun.finish({
      processed: 1,
      completed: 1,
      summary: { published: true, publerJobId: result.publerJobId, dbSyncError: result.dbSyncError },
    })
    return NextResponse.json({ ok: true, published: true, publerJobId: result.publerJobId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
