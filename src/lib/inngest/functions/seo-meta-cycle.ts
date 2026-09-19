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
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { getConnection } from '@/lib/cms/connection-store'
import { GithubClient } from '@/lib/cms/github-client'
import { createCtsRepoApplyAdapter } from '@/lib/seo-meta/cycle/apply-adapter'
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
} from '@/lib/seo-meta/cycle/roster'
import {
  runStep1CheckDue,
  runStep2CandidatesReady,
  runStep3Prescribe,
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

/** Client-agnostic on the fan-out side; the adapter (L3) is resolved per-client here. */
async function buildAdapterForClient(clientId: string): Promise<{ adapter: ApplyAdapter } | null> {
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
  })
  return { adapter }
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
      if (gate.skip) {
        return { status: 'skipped', client_id: clientId, week_key: weekKey, reason: gate.reason }
      }

      const adapterSetup = await step.run('resolve-adapter', async () => {
        const built = await buildAdapterForClient(clientId)
        return built ? { ok: true as const } : { ok: false as const }
      })
      if (!adapterSetup.ok) {
        // No repo connection configured for this client yet — matches spec §6:
        // Oztop's WordPress adapter is future work, not this PR. Not an error,
        // just nothing to do for this client this week.
        return { status: 'no_adapter', client_id: clientId, week_key: weekKey }
      }
      // step.run results are memoized as plain JSON — the adapter itself
      // (closures over a GithubClient) can't cross that boundary, so it's
      // rebuilt here in the function body (cheap: no network call yet).
      const resolved = await buildAdapterForClient(clientId)
      if (!resolved) return { status: 'no_adapter', client_id: clientId, week_key: weekKey }
      const { adapter } = resolved

      const roster = await step.run('load-client-config', async () => {
        const r = await loadMetaCycleRoster(supabaseAdmin)
        if (!r.ok) return null
        return r.entries.find((e) => e.clientId === clientId) ?? null
      })
      if (!roster) {
        return { status: 'not_in_roster', client_id: clientId, week_key: weekKey }
      }
      const config = toClientConfig(roster)

      // Step 1: check_due
      const step1 = await step.run('check-due', async () => runStep1CheckDue(supabaseAdmin, adapter, config, weekKey, false))
      await step.run('log-step1-receipt', async () => writeStepReceipt(supabaseAdmin, {
        jobName: STEP1_JOB_NAME, clientId, weekKey, status: 'completed',
        processed: step1.checked, completed: step1.checked, failed: 0, summary: step1,
      }))

      // Step 2: candidates_ready
      const step2 = await step.run('candidates-ready', async () =>
        runStep2CandidatesReady(supabaseAdmin, config, weekKey, new Set(step1.revertedSlugs)),
      )
      await step.run('log-step2-receipt', async () => writeStepReceipt(supabaseAdmin, {
        jobName: STEP2_JOB_NAME, clientId, weekKey, status: 'completed',
        processed: step2.candidates.length, completed: step2.candidates.length, failed: 0,
        summary: { candidate_count: step2.candidates.length, dataforseo_calls: step2.dataforseoCallsMade, budget_overrun: step2.budgetOverrun },
      }))

      // Step 3: prescribed (pure — no I/O, still its own step for replay clarity + its own receipt)
      const step3 = await step.run('prescribed', async () => runStep3Prescribe(step2.candidates, config.maxPagesPerRun))
      await step.run('log-step3-receipt', async () => writeStepReceipt(supabaseAdmin, {
        jobName: STEP3_JOB_NAME, clientId, weekKey, status: 'completed',
        processed: step3.prescriptions.length, completed: step3.autoCount, failed: 0,
        summary: { auto: step3.autoCount, manual: step3.manualCount, skip: step3.skipCount },
      }))

      // Step 4: applied (also writes seo_meta_log rows — step 5 "logged" is
      // the receipt below, the actual log rows are written inside step 4
      // because they need the exact applied title/desc from the same call).
      const step4 = await step.run('applied', async () =>
        runStep4Applied(supabaseAdmin, adapter, config, weekKey, step3.prescriptions, generateMetaCycleTitle, false),
      )
      await step.run('log-step4-receipt', async () => writeStepReceipt(supabaseAdmin, {
        jobName: STEP4_JOB_NAME, clientId, weekKey, status: 'completed',
        processed: step4.applied.length, completed: step4.applied.length, failed: 0, summary: step4,
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
        reverted: step1.reverted, candidates: step2.candidates.length,
        auto_applied: step4.applied.length, manual_routed: step3.manualCount + step1.routedToManual,
        index_requests_sent: step4.indexRequestsSent,
      }
      await step.run('log-step6-receipt', async () => writeStepReceipt(supabaseAdmin, {
        jobName: STEP6_JOB_NAME, clientId, weekKey, status: 'completed',
        processed: 1, completed: 1, failed: 0, summary,
      }))

      return { status: 'completed', client_id: clientId, week_key: weekKey, ...summary }
    },
  )
}

export const seoMetaCycleFanOut = createSeoMetaCycleFanOutFunction({ loadRoster: loadMetaCycleRoster, supabase: supabaseAdmin })
export const seoMetaCycleRunOne = createSeoMetaCycleRunOneFunction()
