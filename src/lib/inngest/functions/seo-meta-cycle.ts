/**
 * SEO Meta-Cycle v1 (docs/specs/2026-09-20-seo-meta-cycle-v1-spec.md).
 *
 * Two Inngest functions, same shape as flywheel-seo-weekly.ts (子牙 finding
 * #1 — a for-loop over clients inside one function would replay the whole
 * loop on every step boundary and misbehave on retries):
 *   · `cloud-seo-meta-cycle-fanout` — cron-triggered, loads the roster,
 *     sends one `seo/meta-cycle.due` event per eligible client, ends.
 *   · `cloud-seo-meta-cycle-run-one` — runs the six-step chain for one
 *     client. Every side effect is in its own `step.run` (idempotent via
 *     Inngest's step memoization on function-level retry — see
 *     cycle/receipts.ts's header comment on why per-step `retries` isn't a
 *     thing in this SDK), and each step writes its own cron_run_logs
 *     receipt so a failure at any step is visible on its own, not only in a
 *     final rollup (子牙 finding #10).
 *
 * 🔴 `buildAdapterForClient` is called exactly ONCE per invocation and is
 *    deliberately NOT wrapped in its own `step.run`: the `ApplyAdapter` it
 *    returns is a stateful closure (a GithubClient + an in-memory file
 *    cache) that cannot cross Inngest's step-memoization boundary (only
 *    JSON survives that boundary) — so memoizing just the ok/not-ok check
 *    bought nothing and only meant the real object still had to be rebuilt
 *    right after, i.e. `getConnection` (a real Supabase read + token
 *    decrypt) ran twice for no benefit. Calling it once, plainly, is both
 *    simpler and cheaper.
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { getConnection } from '@/lib/cms/connection-store'
import { GithubClient } from '@/lib/cms/github-client'
import { createCtsRepoApplyAdapter } from '@/lib/seo-meta/cycle/apply-adapter'
import { createPageWriteGuard, SYSTEM_ACTOR } from '@/lib/seo/protected-pages'
import { generateMetaCycleTitle } from '@/lib/seo-meta/cycle/ai-meta'
import {
  META_CYCLE_CRON,
  META_CYCLE_DUE_EVENT,
  META_CYCLE_JOB,
  isoWeekKey,
  loadMetaCycleRoster,
  metaCycleEventId,
  recentlyCycled,
  toClientConfig,
  type MetaCycleRosterEntry,
} from '@/lib/seo-meta/cycle/roster'
import {
  runStep1CheckDue,
  runStep2CandidatesReady,
  runStep3Gate,
  runStep4Applied,
} from '@/lib/seo-meta/cycle/runner'
import {
  STEP1_JOB_NAME,
  STEP2_JOB_NAME,
  STEP3_JOB_NAME,
  STEP4_JOB_NAME,
  STEP5_JOB_NAME,
  STEP6_JOB_NAME,
  writeStepReceipt,
} from '@/lib/seo-meta/cycle/receipts'
import type { ApplyAdapter } from '@/lib/seo-meta/cycle/types'

export interface MetaCycleFanOutReceipt {
  readonly job: string
  readonly week_key: string
  readonly status: 'dispatched' | 'roster_failed' | 'roster_empty'
  readonly clients_dispatched: number
  readonly no_publish: false
  readonly error: string | null
}

export function createSeoMetaCycleFanOutFunction(deps: {
  loadRoster: typeof loadMetaCycleRoster
  supabase: typeof supabaseAdmin
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}seo-meta-cycle-fanout`,
      name: 'SEO meta-cycle: dispatch one run per enabled client',
      concurrency: { limit: 1 },
      retries: 2,
    },
    { cron: META_CYCLE_CRON },
    async ({ step }): Promise<MetaCycleFanOutReceipt> => {
      const weekKey = isoWeekKey(new Date())

      const roster = await step.run('load-roster', async () => deps.loadRoster(deps.supabase))

      if (!roster.ok) {
        return { job: META_CYCLE_JOB, week_key: weekKey, status: 'roster_failed', clients_dispatched: 0, no_publish: false, error: roster.reason }
      }
      if (roster.entries.length === 0) {
        return { job: META_CYCLE_JOB, week_key: weekKey, status: 'roster_empty', clients_dispatched: 0, no_publish: false, error: null }
      }

      const events = roster.entries.map((entry) => ({
        id: metaCycleEventId(entry.clientId, weekKey),
        name: META_CYCLE_DUE_EVENT,
        data: { client_id: entry.clientId, week_key: weekKey },
      }))
      await step.sendEvent('dispatch-runs', events)

      return { job: META_CYCLE_JOB, week_key: weekKey, status: 'dispatched', clients_dispatched: events.length, no_publish: false, error: null }
    },
  )
}

/**
 * Client-agnostic on the fan-out side; the adapter (L3) is resolved
 * per-client here. Exported so the manual dry-run trigger route
 * (/api/cron/seo-meta-cycle-trigger) can build the same adapter without
 * going through Inngest — a dry run needs to return its results
 * synchronously in the HTTP response, which Inngest's fire-and-forget event
 * model can't do.
 */
export async function buildAdapterForClient(clientId: string): Promise<{ adapter: ApplyAdapter } | null> {
  // getConnection only ever queries provider=GITHUB (connection-store.ts), so
  // a non-null result is always repo-shaped — CmsConnectionStatus already
  // types repoOwner/repoName/branch directly, no cast needed.
  const conn = await getConnection(clientId)
  if (!conn) return null
  const github = new GithubClient(conn.plainToken)
  const adapter = createCtsRepoApplyAdapter(github, {
    repoOwner: conn.repoOwner,
    repoName: conn.repoName,
    defaultBranch: conn.branch || 'main',
    dataDir: 'src/lib/data',
  }, createPageWriteGuard({ supabase: supabaseAdmin, clientId, actor: SYSTEM_ACTOR, route: 'seo-meta-cycle' }))
  return { adapter }
}

/** Every early exit still leaves a step6 receipt — a client stuck at
 *  'no_adapter' every week should be distinguishable in cron_run_logs from
 *  one that simply never got dispatched, not invisible until someone reads
 *  Inngest's own run history. */
async function earlyExit(clientId: string, weekKey: string, status: string, reason: string) {
  await writeStepReceipt(supabaseAdmin, {
    jobName: STEP6_JOB_NAME, clientId, weekKey, status: 'completed',
    processed: 0, completed: 0, failed: 0, summary: { early_exit: status, reason },
  })
  return { status, client_id: clientId, week_key: weekKey, reason }
}

async function runSixSteps(
  step: Parameters<Parameters<typeof inngest.createFunction>[2]>[0]['step'],
  adapter: ApplyAdapter,
  config: ReturnType<typeof toClientConfig>,
  clientId: string,
  weekKey: string,
) {
  // Step 1: check_due
  const step1 = await step.run('check-due', async () => runStep1CheckDue(supabaseAdmin, adapter, config, weekKey, false))
  await step.run('log-step1-receipt', async () => writeStepReceipt(supabaseAdmin, {
    jobName: STEP1_JOB_NAME, clientId, weekKey, status: 'completed',
    processed: step1.checked, completed: step1.checked, failed: 0,
    // The page-CTR check is off during the rank shadow period (runner.ts Step1Options); say so
    // in the receipt, so zeros here read as "switched off" and not "nothing was due".
    summary: { ...step1, legacy_ctr_check: 'off_rank_shadow_period' },
  }))

  // Step 2: candidates_ready
  const step2 = await step.run('candidates-ready', async () => runStep2CandidatesReady(supabaseAdmin, config))
  await step.run('log-step2-receipt', async () => writeStepReceipt(supabaseAdmin, {
    jobName: STEP2_JOB_NAME, clientId, weekKey, status: 'completed',
    processed: step2.candidates.length, completed: step2.candidates.length, failed: 0,
    summary: { candidate_count: step2.candidates.length },
  }))

  // Step 3: gated (information-completeness gate, PM 2026-09-20 incident
  // follow-up — real I/O now: live GSC page-query calls, keyword_snapshots
  // reads, live SERP checks. No longer pure.)
  const step3 = await step.run('gated', async () => runStep3Gate(supabaseAdmin, adapter, config, step2.candidates))
  await step.run('log-step3-receipt', async () => writeStepReceipt(supabaseAdmin, {
    jobName: STEP3_JOB_NAME, clientId, weekKey, status: 'completed',
    processed: step3.passed.length + step3.failures.length, completed: step3.passed.length, failed: step3.failures.length,
    summary: { passed: step3.passed.length, failures: step3.failures.map((f: typeof step3.failures[number]) => ({ slug: f.candidate.slug, reason: f.reason, detail: f.detail })) },
  }))

  // Step 4: applied (also writes seo_meta_log rows — step 5 "logged" is
  // the receipt below, the actual log rows are written inside step 4
  // because they need the exact applied title/desc from the same call).
  const step4 = await step.run('applied', async () =>
    runStep4Applied(supabaseAdmin, adapter, config, weekKey, step3.passed, generateMetaCycleTitle, false),
  )
  await step.run('log-step4-receipt', async () => writeStepReceipt(supabaseAdmin, {
    jobName: STEP4_JOB_NAME, clientId, weekKey, status: 'completed',
    processed: step4.proposals.length, completed: step4.applied.length,
    failed: step4.proposals.filter((p: typeof step4.proposals[number]) => !p.applied).length,
    summary: step4,
  }))

  // Step 5: logged (rollup receipt over step 4's writes)
  await step.run('log-step5-receipt', async () => writeStepReceipt(supabaseAdmin, {
    jobName: STEP5_JOB_NAME, clientId, weekKey, status: 'completed',
    processed: step4.applied.length, completed: step4.applied.length, failed: 0,
    summary: { logged_rows: step4.applied.length },
  }))

  // Step 6: completed — final rollup receipt (also the recentlyCycled dedup marker).
  const summary = {
    checked: step1.checked, improved: step1.improved, regressed: step1.regressed,
    candidates: step2.candidates.length,
    auto_applied: step4.applied.length, manual_routed: step4.routedManual + step1.routedToManual,
  }
  await step.run('log-step6-receipt', async () => writeStepReceipt(supabaseAdmin, {
    jobName: STEP6_JOB_NAME, clientId, weekKey, status: 'completed',
    processed: 1, completed: 1, failed: 0, summary,
  }))

  return { status: 'completed' as const, client_id: clientId, week_key: weekKey, ...summary }
}

export function createSeoMetaCycleRunOneFunction() {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}seo-meta-cycle-run-one`,
      name: 'SEO meta-cycle: run the six-step chain for one client',
      concurrency: { limit: 1, key: 'event.data.client_id' },
      retries: 2,
      onFailure: async ({ event, error }) => {
        const nested = (event.data as { event?: { data?: { client_id?: string; week_key?: string } } } | undefined)?.event?.data
        await writeStepReceipt(supabaseAdmin, {
          jobName: STEP6_JOB_NAME,
          clientId: nested?.client_id ?? 'unknown',
          weekKey: nested?.week_key ?? 'unknown',
          status: 'failed',
          processed: 1, completed: 0, failed: 1,
          summary: { retries_exhausted: true },
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      },
    },
    { event: META_CYCLE_DUE_EVENT },
    async ({ event, step }) => {
      const clientId = event.data.client_id as string
      const weekKey = event.data.week_key as string

      const gate = await step.run('check-recently-cycled', async () => recentlyCycled(supabaseAdmin, clientId))
      if (gate.skip) return earlyExit(clientId, weekKey, 'skipped', gate.reason ?? 'recently_cycled')

      const resolved = await buildAdapterForClient(clientId)
      if (!resolved) {
        // No repo connection configured for this client yet — matches spec §6:
        // Oztop's WordPress adapter is future work, not this PR.
        return earlyExit(clientId, weekKey, 'no_adapter', 'no repo connection configured for this client')
      }

      const rosterEntry = await step.run('load-client-config', async () => {
        const r = await loadMetaCycleRoster(supabaseAdmin)
        if (!r.ok) return null
        return r.entries.find((e) => e.clientId === clientId) ?? null
      })
      if (!rosterEntry) {
        return earlyExit(clientId, weekKey, 'not_in_roster', 'client dropped out of the meta_cycle_enabled roster between dispatch and run')
      }

      return runSixSteps(step, resolved.adapter, toClientConfig(rosterEntry as MetaCycleRosterEntry), clientId, weekKey)
    },
  )
}

export const seoMetaCycleFanOut = createSeoMetaCycleFanOutFunction({ loadRoster: loadMetaCycleRoster, supabase: supabaseAdmin })
export const seoMetaCycleRunOne = createSeoMetaCycleRunOneFunction()
