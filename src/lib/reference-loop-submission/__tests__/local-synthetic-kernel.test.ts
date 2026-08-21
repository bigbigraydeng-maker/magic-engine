/** LOCAL SYNTHETIC proof only: no live customer data, provider call, or production write. */
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
import { createDefaultDeps } from '@/lib/action-submission'
import { createPageApplyWordpressCapability } from '@/lib/capabilities/page-apply-wordpress'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { approveAndRun } from '@/lib/kernel/runner'
import { CLIENT_A, CLIENT_B, GOAL_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { listPendingApprovals } from '@/lib/kernel-approval/service'
import type { ExistingWordpressPost } from '@/lib/cms/wordpress-client'
import { prepareReferenceLoopChange, type ReferenceLoopInput } from '@/lib/reference-loop'
import {
  loadTenantBoundWordpressSource,
  type TenantBoundWordpressSource,
} from '@/lib/capabilities/page-apply-wordpress/source'
import { submitValidatedWordpressReferenceLoop } from '..'
import {
  createGscPageQueryEvidenceReceipt,
  fetchGscPageQueryReport,
  type GscPageQueryEvidenceReceipt,
} from '@/lib/gsc/client'

const PAGE_URL = 'https://customer-zero.example.nz/'
const MODIFIED = '2026-08-20T01:00:00.000Z'
const OBSERVED = '2026-08-20T16:10:00.000Z'
const BEFORE_TITLE = 'Escorted Tours | Example'
const AFTER_TITLE = 'Escorted Asia Tours from New Zealand | Example'
let evidenceReceipt: GscPageQueryEvidenceReceipt
let tenantTarget: TenantBoundWordpressSource
const ORIGINAL_PROOF_KEY = process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY

beforeAll(async () => {
  process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY =
    'local-test-proof-secret-that-is-at-least-32-bytes'
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    rows: [{
      keys: [PAGE_URL, 'example tours'],
      clicks: 2,
      impressions: 195,
      ctr: 0.010256410256410256,
      position: 14.876923076923077,
    }],
  }), { status: 200 }))
  const params = {
    accessToken: 'local-synthetic-token',
    siteUrl: 'sc-domain:customer-zero.example.nz',
    startDate: '2026-07-23',
    endDate: '2026-08-20',
    country: 'nzl',
  }
  const [row] = await fetchGscPageQueryReport(params)
  evidenceReceipt = createGscPageQueryEvidenceReceipt(params, row)
  fetchSpy.mockRestore()

  sourceMocks.getSitePageForClient.mockResolvedValue({
    id: 'synthetic-page-42', client_id: CLIENT_A, url: PAGE_URL,
  })
  sourceMocks.getWordpressConnection.mockResolvedValue({
    siteUrl: 'https://customer-zero.example.nz',
    username: 'synthetic',
    plainAppPassword: 'not-real',
    status: 'connected',
    yoastPluginInstalled: true,
  })
  sourceMocks.getExistingWordpressPost.mockResolvedValue({
    postId: 42,
    postType: 'page',
    title: 'Example Tours',
    content: '<main>Example escorted tours.</main>',
    status: 'publish',
    link: PAGE_URL,
    modified: MODIFIED,
    seoTitle: BEFORE_TITLE,
    seoDescription: 'Escorted tours from New Zealand.',
  })
  sourceMocks.probeWordpressAtomicPageApply.mockResolvedValue(true)
  const loaded = await loadTenantBoundWordpressSource({
    clientId: CLIENT_A,
    pageId: 'synthetic-page-42',
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

function referenceInput(): ReferenceLoopInput {
  const finding = {
    pillar: 'seo',
    severity: 'high',
    statement: 'The homepage is receiving a query that should have explicit URL ownership.',
    evidence: [{
      source: { kind: 'gsc', sourceId: evidenceReceipt.evidence_source_id },
      observedAt: evidenceReceipt.collected_at,
      rawLocator: { known: true, value: 'local-synthetic-fixture:row-1' },
      interpretation: { known: true, value: { parserVersion: 'synthetic-v1' } },
      confidence: { known: true, value: 1 },
    }],
  } as const
  return {
    clientId: CLIENT_A,
    clientDomain: 'customer-zero.example.nz',
    targetPageUrl: PAGE_URL,
    finding,
    prescription: {
      goalId: { known: true, value: GOAL_A },
      covers: [finding],
      notDoing: [{ statement: 'Do not change body content.', reason: 'Not authorized.' }],
      orderingRationale: 'Clarify URL ownership with the smallest metadata-only change.',
    },
    findingRefs: ['synthetic:gsc:page-query:row-1'],
    intents: [{
      field: 'meta_title',
      proposedValue: AFTER_TITLE,
      semanticIntent: { known: true, value: 'Clarify NZ buyer and page scope.' },
    }],
    verification: {
      metricRef: 'gsc.page_query.url_ownership',
      windowDays: 28,
      baseline: 'synthetic prior window',
      criteria: {
        success: 'dedicated target gains ownership',
        failure: 'homepage remains sole selected URL',
        indeterminate: 'not enough rows',
      },
    },
    providers: {
      github: null,
      wordpress: {
        connected: true,
        provider: 'wordpress',
        siteUrl: 'https://customer-zero.example.nz',
        username: 'synthetic',
        tokenHint: null,
        status: 'connected',
        lastError: null,
        lastTestedAt: OBSERVED,
        yoastPluginInstalled: true,
        wpDefaultCategoryId: null,
      },
      shopify: null,
    },
    snapshot: tenantTarget.snapshot,
    redline: { available: true, phrases: [] },
    providerCheck: { evaluated: true, passed: true },
    provenance: {
      clientIdSource: 'local-synthetic-clients-row',
      targetPageUrlSource: 'local-synthetic-page-ledger-row',
      findingSource: 'local-synthetic-gsc-row',
      prescriptionSource: 'local-synthetic-prescription',
      intentsSource: 'local-synthetic-intent',
      snapshotSource: 'local-synthetic-wordpress-post',
      redlineSource: 'local-synthetic-client-policy',
      providerCheckSource: 'local-synthetic-provider-check',
      verificationSource: 'local-synthetic-measurement-plan',
      findingRefsSource: 'local-synthetic-gsc-row',
      collectedAt: OBSERVED,
      window: { known: true, value: { startAt: '2026-07-23', endAt: '2026-08-20' } },
    },
  }
}

function preparation() {
  const result = prepareReferenceLoopChange(referenceInput())
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason)
  return result.preparation
}

function target() {
  return tenantTarget
}

describe('LOCAL SYNTHETIC · generic WordPress evidence → governed pending approval', () => {
  it('pins input and stops before every provider capability call', async () => {
    const resolveConnection = vi.fn()
    const readPost = vi.fn()
    const updatePost = vi.fn()
    const capability = createPageApplyWordpressCapability({
      resolveConnection,
      readPost,
      updatePost,
      supportsAtomicApply: async () => true,
    })
    const fixture = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({
        'page.apply_wordpress_optimization_request': capability,
      }),
      options: {
        policy: {
          action_key: 'page.apply_wordpress_optimization_request',
          mode: 'require_approval',
        },
      },
    })
    const sourceReceipt = evidenceReceipt

    const result = await submitValidatedWordpressReferenceLoop(
      { caller: createDefaultDeps(fixture.kernel) },
      {
        preparation: preparation(),
        target: target(),
        sourceReceipt,
        kernelMeta: {
          clientId: CLIENT_A,
          purpose: 'growth',
          goalId: GOAL_A,
          triggeredBy: 'human',
          rationale: 'LOCAL SYNTHETIC integration proof',
        },
      },
    )

    expect(result).toMatchObject({ ok: true, outcome: 'pending_approval' })
    expect(resolveConnection).not.toHaveBeenCalled()
    expect(readPost).not.toHaveBeenCalled()
    expect(updatePost).not.toHaveBeenCalled()

    expect(fixture.tables.action_runs).toHaveLength(1)
    expect(fixture.tables.authorization_decisions).toHaveLength(1)
    const run = fixture.tables.action_runs[0]
    const decision = fixture.tables.authorization_decisions[0]
    expect(run).toMatchObject({
      client_id: CLIENT_A,
      action_key: 'page.apply_wordpress_optimization_request',
      action_version: 1,
      status: 'pending_approval',
      goal_id: GOAL_A,
      input: {
        page_url: PAGE_URL,
        page_version_token: MODIFIED,
        wordpress_post_id: 42,
        wordpress_post_type: 'page',
        authorization_context: {
          client_id: CLIENT_A,
          validation_passed: true,
          target_page_url: PAGE_URL,
          source_receipt: sourceReceipt,
        },
      },
    })
    expect((run.evidence as Record<string, unknown>).authorization_context).toEqual(
      (run.input as Record<string, unknown>).authorization_context,
    )
    expect(decision).toMatchObject({
      client_id: CLIENT_A,
      action_run_id: run.id,
      action_key: run.action_key,
      action_version: run.action_version,
      idempotency_key: run.idempotency_key,
      verdict: 'require_approval',
    })
    expect((decision.policy_snapshot as { input_hash?: unknown }).input_hash).toBe(
      canonicalHashOfInput(run.input),
    )

    const forA = await listPendingApprovals(fixture.supabase, CLIENT_A)
    const forB = await listPendingApprovals(fixture.supabase, CLIENT_B)
    expect(forA.items).toHaveLength(1)
    expect(forA.items[0]).toMatchObject({ runId: run.id, clientId: CLIENT_A })
    expect(forA.skippedRunIds).toEqual([])
    expect(forB.items).toEqual([])
  })

  it('executes through real Kernel only after a local human approval', async () => {
    let current: ExistingWordpressPost = {
      postId: 42,
      postType: 'page',
      title: 'Example Tours',
      slug: 'home',
      excerpt: '',
      content: '<main>Example escorted tours.</main>',
      status: 'publish',
      link: PAGE_URL,
      modified: MODIFIED,
      seoTitle: BEFORE_TITLE,
      seoDescription: 'Escorted tours from New Zealand.',
    }
    const resolveConnection = vi.fn(async () => ({
      config: {
        siteUrl: 'https://customer-zero.example.nz',
        username: 'local-synthetic',
        appPassword: 'not-a-real-secret',
      },
      status: 'connected' as const,
      yoastPluginInstalled: true,
    }))
    const readPost = vi.fn(async () => ({ ...current }))
    const updatePost = vi.fn(async (_config, update, expectedModified) => {
      if (expectedModified !== current.modified) throw new Error('synthetic CAS mismatch')
      const previousModified = current.modified
      current = {
        ...current,
        ...(update.seoTitle === undefined ? {} : { seoTitle: update.seoTitle }),
        ...(update.seoDescription === undefined
          ? {}
          : { seoDescription: update.seoDescription }),
        modified: '2026-08-20T17:00:00.000Z',
      }
      return {
        postId: current.postId,
        postType: current.postType,
        link: current.link,
        previousModified,
        modified: current.modified,
        updatedFields: [
          ...(update.seoTitle === undefined ? [] : ['seoTitle']),
          ...(update.seoDescription === undefined ? [] : ['seoDescription']),
        ],
      }
    })
    const fixture = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({
        'page.apply_wordpress_optimization_request': createPageApplyWordpressCapability({
          resolveConnection,
          readPost,
          updatePost,
          supportsAtomicApply: async () => true,
        }),
      }),
      options: {
        policy: {
          action_key: 'page.apply_wordpress_optimization_request',
          mode: 'require_approval',
        },
      },
    })
    const pending = await submitValidatedWordpressReferenceLoop(
      { caller: createDefaultDeps(fixture.kernel) },
      {
        preparation: preparation(),
        target: target(),
        sourceReceipt: evidenceReceipt,
        kernelMeta: {
          clientId: CLIENT_A,
          purpose: 'growth',
          goalId: GOAL_A,
          triggeredBy: 'human',
          rationale: 'LOCAL SYNTHETIC execution proof',
        },
      },
    )
    expect(pending).toMatchObject({ ok: true, outcome: 'pending_approval' })
    expect(resolveConnection).not.toHaveBeenCalled()
    expect(updatePost).not.toHaveBeenCalled()
    if (!pending.ok) throw new Error(pending.reason)

    const executed = await approveAndRun(
      fixture.kernel,
      pending.runId,
      'local-reviewer@example.invalid',
    )

    expect(executed.kind).toBe('succeeded')
    expect(current.seoTitle).toBe(AFTER_TITLE)
    expect(current.seoDescription).toBe('Escorted tours from New Zealand.')
    expect(updatePost).toHaveBeenCalledTimes(1)
    expect(updatePost.mock.calls[0][1]).not.toHaveProperty('seoDescription')
    expect(fixture.tables.authorization_decisions.map((row) => row.verdict)).toEqual([
      'require_approval',
      'allow',
    ])
  })
})
