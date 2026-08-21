/**
 * One-shot CTS Customer Zero runner.
 *
 * Fixed scope: live NZ GSC evidence -> Kernel pending approval -> append-only
 * human allow -> governed CTS GitHub capability -> Draft PR. It cannot merge or
 * deploy. Run only in the private Render one-off environment for the isolated
 * implementation branch.
 */
import { createDefaultDeps } from '@/lib/action-submission'
import { triggerCtsGithubMetadataReferenceLoop } from '@/lib/cts-github-reference-loop-trigger'
import { getValidToken } from '@/lib/platform-oauth/token-manager'
import { CTS_CLIENT_ID } from '@/lib/seo-meta/cts-meta-source'
import { approveAndRun, createKernel } from '@/lib/kernel'
import { supabaseAdmin } from '@/lib/supabase'

const PAGE_ID = '75df9241-5633-4a1d-95e6-a30d55079baf'
const APPROVER = process.env.CTS_CUSTOMER_ZERO_APPROVED_BY?.trim() ?? ''

function triggerFailureCode(
  result: Awaited<ReturnType<typeof triggerCtsGithubMetadataReferenceLoop>>,
): string {
  if (result.ok) return 'kernel_submission_not_pending'
  if (result.reason === 'cts_trigger_not_ready') {
    const safeUpstreamReasons = new Set([
      'connection_not_ready',
      'invalid_identity',
      'ledger_page_not_found',
      'provider_read_failed',
      'source_entry_invalid',
      'target_scope_invalid',
      'target_slug_invalid',
      'target_source_not_found',
    ])
    const upstream = result.upstreamReason && safeUpstreamReasons.has(result.upstreamReason)
      ? `_${result.upstreamReason}`
      : ''
    return `trigger_${result.detail}${upstream}`
  }
  return `trigger_${result.reason}`
}

function preflight(): void {
  if (process.env.CTS_GITHUB_METADATA_ACTION_ENABLED !== 'true') {
    throw new Error('rollout_disabled')
  }
  if ((process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY?.length ?? 0) < 32) {
    throw new Error('authorization_proof_unavailable')
  }
  if (!APPROVER) throw new Error('approved_by_missing')
}

async function main(): Promise<void> {
  preflight()
  const kernel = createKernel(supabaseAdmin, {
    workerId: 'render-cts-customer-zero-once',
    ownerId: 'render-cts-customer-zero-once',
  })
  let accessToken: string
  try {
    accessToken = await getValidToken(CTS_CLIENT_ID, 'google_gsc')
  } catch {
    throw new Error('gsc_token_unavailable')
  }

  let submitted: Awaited<ReturnType<typeof triggerCtsGithubMetadataReferenceLoop>>
  try {
    submitted = await triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(kernel) },
      {
        pageId: PAGE_ID,
        gsc: {
          accessToken,
          startDate: '2026-07-23',
          endDate: '2026-08-20',
          evidencePageUrl: 'https://www.ctstours.co.nz/',
          query: 'china tours',
        },
        proposal: {
          title: 'China Tours & Holiday Packages | CTS Tours',
          description: 'Explore the complete CTS collection of escorted, private and special-interest China tours.',
          h1: 'Explore All China Tours',
          titleRationale: 'Differentiate the generic collection from the NZ-specific landing page.',
          descriptionRationale: 'Describe the range of tour formats without changing body copy.',
          h1Rationale: 'Give the generic hub a collection-focused heading.',
        },
        growth: {
          goalId: null,
          orderingRationale: 'Test the smallest three-field intent distinction before considering body edits.',
          verification: {
            windowDays: 28,
            baseline: 'CTS NZ exact page×query window ending 2026-08-20',
            success: '/china-tours becomes the selected URL for “china tours”',
            failure: 'the homepage remains the selected URL for “china tours”',
            indeterminate: 'privacy filtering or insufficient page×query rows',
          },
        },
        kernel: {
          triggeredBy: 'human',
          triggeredByRef: 'codex-customer-zero-2026-08-21',
          rationale: 'PM authorized one CTS Customer Zero Kernel approval and Draft PR on 2026-08-21.',
          correlationId: 'c7500000-0000-4000-8000-000000002026',
        },
      },
    )
  } catch {
    throw new Error('trigger_threw')
  }
  if (!submitted.ok || submitted.outcome !== 'pending_approval') {
    throw new Error(triggerFailureCode(submitted))
  }

  const completed = await approveAndRun(kernel, submitted.runId, APPROVER)
  const receipt = {
    outcome: completed.kind,
    runId: completed.run.id,
    decisionId: completed.decision?.id ?? null,
    runStatus: completed.run.status,
    output: completed.run.output ?? null,
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
  if (completed.kind !== 'succeeded') process.exitCode = 1
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^[a-z0-9_]+$/i.test(error.message)
    ? error.message
    : 'cts_customer_zero_failed'
  process.stderr.write(`${JSON.stringify({ outcome: 'failed', code })}\n`)
  process.exitCode = 1
})
