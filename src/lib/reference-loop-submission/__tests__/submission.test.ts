import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const sourceMocks = vi.hoisted(() => ({
  getSitePageForClient: vi.fn(),
  getWordpressConnection: vi.fn(),
  getExistingWordpressPost: vi.fn(),
  probeWordpressAtomicPageApply: vi.fn(),
}))
vi.mock('@/lib/db/site-pages', () => ({ getSitePageForClient: sourceMocks.getSitePageForClient }))
vi.mock('@/lib/cms/connection-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/cms/connection-store')>(),
  getWordpressConnection: sourceMocks.getWordpressConnection,
}))
vi.mock('@/lib/cms/wordpress-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/cms/wordpress-client')>(),
  getExistingWordpressPost: sourceMocks.getExistingWordpressPost,
  probeWordpressAtomicPageApply: sourceMocks.probeWordpressAtomicPageApply,
}))
import { prepareReferenceLoopChange, type ReferenceLoopInput } from '@/lib/reference-loop'
import { mapCandidateIdentity } from '@/lib/action-bridge'
import type { ActionRunOutcome, SubmitActionInput } from '@/lib/kernel/runner'
import type { KernelDeps } from '@/lib/kernel/deps'
import {
  loadTenantBoundWordpressSource,
  type TenantBoundWordpressSource,
} from '@/lib/capabilities/page-apply-wordpress/source'
import {
  createGscPageQueryEvidenceReceipt,
  fetchGscPageQueryReport,
  type GscPageQueryEvidenceReceipt,
} from '@/lib/gsc/client'
import { submitValidatedWordpressReferenceLoop } from '..'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const GOAL = '90a10000-0000-4000-8000-00000000000a'
const PAGE_URL = 'https://customer-zero.example.nz/'
const NEW_TITLE = 'Escorted Asia Tours from New Zealand | Example Tours'
let receipt: GscPageQueryEvidenceReceipt
let tenantTarget: TenantBoundWordpressSource
const ORIGINAL_PROOF_KEY = process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY

beforeAll(async () => {
  process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY =
    'local-test-proof-secret-that-is-at-least-32-bytes'
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    rows: [{
      keys: [PAGE_URL, 'china tours'],
      clicks: 2,
      impressions: 195,
      ctr: 0.010256410256410256,
      position: 14.876923076923077,
    }],
  }), { status: 200 }))
  const params = {
    accessToken: 'local-test-token',
    siteUrl: 'sc-domain:customer-zero.example.nz',
    startDate: '2026-07-23',
    endDate: '2026-08-20',
    country: 'nzl',
  }
  const [row] = await fetchGscPageQueryReport(params)
  receipt = createGscPageQueryEvidenceReceipt(params, row)
  fetchSpy.mockRestore()

  sourceMocks.getSitePageForClient.mockResolvedValue({
    id: 'page-42', client_id: CLIENT, url: PAGE_URL,
  })
  sourceMocks.getWordpressConnection.mockResolvedValue({
    siteUrl: 'https://customer-zero.example.nz',
    username: 'fixture',
    plainAppPassword: 'not-real',
    status: 'connected',
    yoastPluginInstalled: true,
  })
  sourceMocks.getExistingWordpressPost.mockResolvedValue({
    postId: 42,
    postType: 'page',
    title: 'See all of China, the way it deserves.',
    content: '<main>Example escorted tours across Asia.</main>',
    status: 'publish',
    link: PAGE_URL,
    modified: '2026-08-20T01:00:00.000Z',
    seoTitle: 'Escorted Tours from New Zealand | Example Tours',
    seoDescription: 'Discover escorted China tours from New Zealand with Example Tours.',
  })
  sourceMocks.probeWordpressAtomicPageApply.mockResolvedValue(true)
  const loaded = await loadTenantBoundWordpressSource({
    clientId: CLIENT,
    pageId: 'page-42',
    postId: 42,
    postType: 'page',
  })
  if (!loaded.ok) throw new Error(loaded.reason)
  tenantTarget = loaded.source
})

afterAll(() => {
  if (ORIGINAL_PROOF_KEY === undefined) delete process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY
  else process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY = ORIGINAL_PROOF_KEY
})

function referenceInput(providerPassed = true): ReferenceLoopInput {
  const finding = {
    pillar: 'seo',
    severity: 'high',
    statement: 'Google selected the homepage for “china tours” instead of the dedicated hub.',
    evidence: [{
      source: { kind: 'gsc', sourceId: receipt.evidence_source_id },
      observedAt: receipt.collected_at,
      rawLocator: { known: false, reason: 'not_recorded_by_source' },
      interpretation: { known: true, value: { parserVersion: 'gsc-page-query-v1' } },
      confidence: { known: true, value: 1 },
    }],
  } as const
  const verification = {
    metricRef: 'gsc.page_query.url_ownership',
    windowDays: 28,
    baseline: 'previous NZ 28-day web window',
    criteria: {
      success: '/china-tours gains query ownership',
      failure: 'homepage remains the only selected URL',
      indeterminate: 'insufficient page×query rows',
    },
  } as const
  return {
    clientId: CLIENT,
    clientDomain: 'customer-zero.example.nz',
    targetPageUrl: PAGE_URL,
    finding,
    prescription: {
      goalId: { known: true, value: GOAL },
      covers: [finding],
      notDoing: [{
        statement: 'Do not add generic homepage copy.',
        reason: 'The evidence points to URL ownership.',
      }],
      orderingRationale: 'Clarify page ownership first.',
    },
    findingRefs: ['gsc:example:nz:escorted-tours'],
    intents: [{
      field: 'meta_title',
      proposedValue: NEW_TITLE,
      semanticIntent: { known: true, value: 'Keep the homepage Asia-wide.' },
    }],
    verification,
    providers: {
      github: null,
      wordpress: {
        connected: true,
        provider: 'wordpress',
        siteUrl: 'https://customer-zero.example.nz',
        username: 'fixture',
        tokenHint: null,
        status: 'connected',
        lastError: null,
        lastTestedAt: '2026-08-20T04:00:56.944Z',
        yoastPluginInstalled: true,
        wpDefaultCategoryId: null,
      },
      shopify: null,
    },
    snapshot: tenantTarget.snapshot,
    redline: { available: true, phrases: [] },
    providerCheck: providerPassed
      ? { evaluated: true, passed: true }
      : { evaluated: false, reason: 'provider check unavailable' },
    provenance: {
      clientIdSource: 'tenant-bound-fixture',
      targetPageUrlSource: 'client_site_pages.id=page-42',
      findingSource: 'gsc.page_query',
      prescriptionSource: 'customer_zero',
      intentsSource: 'customer_zero',
      snapshotSource: 'wordpress:page:42',
      redlineSource: 'clients.brand_redline_phrases',
      providerCheckSource: 'wordpress.yoast_probe',
      verificationSource: 'customer_zero',
      findingRefsSource: 'gsc.page_query',
      collectedAt: '2026-08-20T16:10:00.000Z',
      window: { known: true, value: { startAt: '2026-07-23', endAt: '2026-08-20' } },
    },
  }
}

function preparation(providerPassed = true) {
  const result = prepareReferenceLoopChange(referenceInput(providerPassed))
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason)
  return result.preparation
}

function boundTarget(): TenantBoundWordpressSource {
  return tenantTarget
}

function callerDeps() {
  let submitted: SubmitActionInput | null = null
  const mapCandidate = vi.fn(mapCandidateIdentity)
  const runAction = vi.fn(async (_deps: KernelDeps, input: SubmitActionInput) => {
    submitted = input
    return {
      kind: 'pending_approval',
      run: { id: 'run-1', authorization_decision_id: 'decision-1' },
      decision: null,
      execution: null,
      humanReason: 'awaiting approval',
    } as unknown as ActionRunOutcome
  })
  return {
    deps: { kernelDeps: {} as KernelDeps, mapCandidate, runAction },
    mapCandidate,
    runAction,
    submitted: () => submitted,
  }
}

describe('submitValidatedWordpressReferenceLoop', () => {
  it('pins one source receipt into both Kernel evidence and the authorized action input', async () => {
    const caller = callerDeps()
    const result = await submitValidatedWordpressReferenceLoop({ caller: caller.deps }, {
      preparation: preparation(),
      target: boundTarget(),
      sourceReceipt: receipt,
      kernelMeta: {
        clientId: CLIENT,
        purpose: 'growth',
        goalId: GOAL,
        triggeredBy: 'human',
      },
    })

    expect(result).toMatchObject({ ok: true, outcome: 'pending_approval' })
    expect(caller.mapCandidate).toHaveBeenCalledWith({
      domain: 'seo',
      intent: 'apply_wordpress_page_metadata',
    })
    const submitted = caller.submitted()
    expect(submitted?.actionKey).toBe('page.apply_wordpress_optimization_request')
    expect(submitted?.input).toMatchObject({
      page_url: PAGE_URL,
      wordpress_post_id: 42,
      wordpress_post_type: 'page',
      authorization_context: {
        page_ledger_ref: 'client_site_pages:page-42',
        source_binding: {
          client_source: `clients:${CLIENT}`,
          page_ledger_source: 'client_site_pages:page-42',
          connection_source: `cms_connections:${CLIENT}:wordpress`,
          post_source: 'wordpress:page:42@2026-08-20T01:00:00.000Z',
        },
        source_receipt: receipt,
      },
    })
    expect(submitted?.evidence).toEqual({
      authorization_context: submitted?.input.authorization_context,
    })
  })

  it('validation_failed cannot reach Bridge or Kernel', async () => {
    const caller = callerDeps()
    const result = await submitValidatedWordpressReferenceLoop({ caller: caller.deps }, {
      preparation: preparation(false),
      target: boundTarget(),
      sourceReceipt: receipt,
      kernelMeta: { clientId: CLIENT, purpose: 'growth', goalId: GOAL, triggeredBy: 'human' },
    })

    expect(result).toEqual({
      ok: false,
      reason: 'reference_loop_not_ready',
      detail: 'validation_not_passed',
    })
    expect(caller.mapCandidate).not.toHaveBeenCalled()
    expect(caller.runAction).not.toHaveBeenCalled()
  })

  it('rejects client and bound-source mismatch before submission', async () => {
    const caller = callerDeps()
    const mismatch = await submitValidatedWordpressReferenceLoop({ caller: caller.deps }, {
      preparation: preparation(),
      target: boundTarget(),
      sourceReceipt: receipt,
      kernelMeta: {
        clientId: 'c11e0000-0000-4000-8000-00000000000b',
        purpose: 'growth',
        goalId: GOAL,
        triggeredBy: 'human',
      },
    })
    expect(mismatch).toMatchObject({ detail: 'client_id_mismatch' })

    const driftedPreparation = preparation()
    const driftedSnapshot = driftedPreparation.snapshot
    if (!driftedSnapshot.ok || driftedSnapshot.provider !== 'wordpress') {
      throw new Error('expected WordPress snapshot')
    }
    const badTarget = await submitValidatedWordpressReferenceLoop({ caller: caller.deps }, {
      preparation: {
        ...driftedPreparation,
        snapshot: {
          ...driftedSnapshot,
          versionToken: '2026-08-20T02:00:00.000Z',
        },
      },
      target: boundTarget(),
      sourceReceipt: receipt,
      kernelMeta: { clientId: CLIENT, purpose: 'growth', goalId: GOAL, triggeredBy: 'human' },
    })
    expect(badTarget).toMatchObject({ detail: 'preparation_untrusted' })
    expect(caller.runAction).not.toHaveBeenCalled()
  })

  it('rejects a receipt that does not point to the prepared finding evidence', async () => {
    const caller = callerDeps()
    const result = await submitValidatedWordpressReferenceLoop({ caller: caller.deps }, {
      preparation: preparation(),
      target: boundTarget(),
      sourceReceipt: { ...receipt, evidence_source_id: 'some-other-evidence' },
      kernelMeta: { clientId: CLIENT, purpose: 'growth', goalId: GOAL, triggeredBy: 'human' },
    })

    expect(result).toMatchObject({ detail: 'source_receipt_untrusted' })
    expect(caller.mapCandidate).not.toHaveBeenCalled()
    expect(caller.runAction).not.toHaveBeenCalled()
  })

  it('rejects a cloned source even when every visible field is identical', async () => {
    const caller = callerDeps()
    const clonedTarget = { ...boundTarget() }
    const result = await submitValidatedWordpressReferenceLoop({ caller: caller.deps }, {
      preparation: preparation(),
      target: clonedTarget,
      sourceReceipt: receipt,
      kernelMeta: { clientId: CLIENT, purpose: 'growth', goalId: GOAL, triggeredBy: 'human' },
    })

    expect(result).toMatchObject({ detail: 'wordpress_source_mismatch' })
    expect(caller.runAction).not.toHaveBeenCalled()
  })

  it('does not create an approval for content_html before rollback is governed', async () => {
    const caller = callerDeps()
    const bodyIntent = {
      field: 'content_html' as const,
      proposedValue: '<main>changed</main>',
      semanticIntent: { known: true as const, value: 'Not currently supported.' },
    }
    const bodyPrepared = prepareReferenceLoopChange({
      ...referenceInput(),
      intents: [bodyIntent],
    })
    expect(bodyPrepared.ok).toBe(true)
    if (!bodyPrepared.ok) throw new Error(bodyPrepared.reason)
    const result = await submitValidatedWordpressReferenceLoop({ caller: caller.deps }, {
      preparation: bodyPrepared.preparation,
      target: boundTarget(),
      sourceReceipt: receipt,
      kernelMeta: { clientId: CLIENT, purpose: 'growth', goalId: GOAL, triggeredBy: 'human' },
    })

    expect(result).toMatchObject({ detail: 'wordpress_body_change_not_supported' })
    expect(caller.runAction).not.toHaveBeenCalled()
  })
})
