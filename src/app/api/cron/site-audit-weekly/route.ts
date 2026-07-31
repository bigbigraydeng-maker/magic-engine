import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { JobRunner } from '@/lib/site-audit/job-runner'
import { executeJob } from '@/lib/site-audit/job-executor'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/site-audit-weekly (22.E.S15)
 *
 * Sunday 01:00 UTC — refresh the site crawl for every focus client
 * (seo_config.weekly_blog=true — the focus-client master switch, see
 * /api/clients/[id]/seo-config), so the patrol's link-graph signals (R2)
 * and blog page-context work from pages at most a week old. Before this
 * cron, crawls only happened when a human clicked "crawl" — CTS's newest
 * page data was 3 months stale.
 *
 * Crawls are kicked off FIRE-AND-FORGET, mirroring the manual crawl route
 * (site-audit/crawl): Render runs a persistent Node server, so the crawl
 * continues after this handler returns (proven by past manual crawls).
 * A full crawl (Jina fetch + classify per page at 3.5s spacing) runs
 * 10-20 min per client — far beyond any sane HTTP wait. Job completion is
 * tracked in site_audit_jobs; the site-audit-cron watchdog handles stalls.
 *
 * Rate: 3500ms/page — Jina's anonymous tier is ~20 RPM and its client
 * treats 429 as fatal per page (CTS lost 10/30 pages to 429 at 1000ms).
 * JINA_API_KEY (optional env) lifts the tier when configured.
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const dynamic = 'force-dynamic'

/** Oztop has 131 discoverable pages; the default cap of 100 dropped the tail. */
const MAX_PAGES = 150
/** ~20 RPM keeps the anonymous Jina tier under its 429 threshold. */
const RATE_LIMIT_MS = 3500

interface ClientRow {
  id: string
  name: string
  domain: string | null
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('site-audit-weekly')

  try {
    const { data: clients, error } = await supabaseAdmin
      .from('clients')
      .select('id, name, domain')
      .contains('seo_config', { weekly_blog: true })
      .not('domain', 'is', null)

    if (error) throw new Error(`Failed to load clients: ${error.message}`)

    const runner = new JobRunner(supabaseAdmin)
    const results: Array<{ name: string; outcome: string; job_id?: string; error?: string }> = []

    for (const client of (clients ?? []) as ClientRow[]) {
      if (!client.domain) continue

      try {
        // One in-progress job per client: an already-running crawl (likely
        // human-triggered) wins; skip rather than force-cancel it. Stuck
        // in_progress jobs are failed by the daily watchdog, so a zombie
        // can block a client for at most one week.
        const existing = await runner.getInProgressJob(client.id)
        if (existing) {
          results.push({ name: client.name, outcome: 'skipped_job_in_progress' })
          continue
        }

        const job = await runner.createJob(client.id, {
          domain: client.domain,
          maxPages: MAX_PAGES,
          rateLimitMs: RATE_LIMIT_MS,
        })

        // Fire-and-forget — same pattern as the manual crawl route.
        void executeJob(supabaseAdmin, job.id, {
          maxPages: MAX_PAGES,
          rateLimitMs: RATE_LIMIT_MS,
        }).catch((err: unknown) => {
          console.error(
            `[site-audit-weekly] background crawl failed for job ${job.id}:`,
            err instanceof Error ? err.message : String(err),
          )
        })

        results.push({ name: client.name, outcome: 'crawl_started', job_id: job.id })
      } catch (err) {
        results.push({
          name: client.name,
          outcome: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const failed = results.filter((r) => r.outcome === 'error').length
    await cronRun.finish({
      processed: results.length,
      completed: results.filter((r) => r.outcome === 'crawl_started').length,
      failed,
      summary: { results },
    })

    return NextResponse.json({ success: true, results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
