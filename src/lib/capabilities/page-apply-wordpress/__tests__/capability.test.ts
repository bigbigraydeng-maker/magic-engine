import { describe, expect, it, vi } from 'vitest'
import type { AuthorizedExecutionContext, CapabilityStepContext } from '@/lib/kernel/types'
import type { ExistingWordpressPost } from '@/lib/cms/wordpress-client'
import { canonicalDiffHash } from '@/lib/capabilities/page-apply-optimization/hash'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { createPageApplyWordpressCapability } from '..'
import type { PageApplyWordpressDeps } from '../deps'
import type { GrowthJsonValue } from '@/lib/growth'
import { createHmac, timingSafeEqual } from 'node:crypto'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const PAGE_URL = 'https://customer-zero.example.nz/'
const OLD_TITLE = 'Escorted Tours from New Zealand | Example Tours'
const NEW_TITLE = 'Escorted Asia Tours from New Zealand | Example Tours'
const VERSION = '2026-08-20T01:00:00.000Z'
const AFTER_VERSION = '2026-08-20T02:00:00.000Z'
const EVIDENCE_SOURCE_ID = 'example-nz-page-query-2026-08-20'
const PROOF_SECRET = 'local-test-proof-secret-that-is-at-least-32-bytes'

function signProof(payload: GrowthJsonValue): string {
  return `hmac-sha256:${createHmac('sha256', PROOF_SECRET)
    .update(canonicalHashOfInput(payload)).digest('hex')}`
}

function verifyProof(payload: GrowthJsonValue, proof: unknown): boolean {
  if (typeof proof !== 'string') return false
  const expected = signProof(payload)
  const a = Buffer.from(proof)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const finding = {
  pillar: 'seo',
  severity: 'high',
  statement: 'The homepage owns the query instead of the intended page.',
  evidence: [{
    source: { kind: 'gsc', sourceId: EVIDENCE_SOURCE_ID },
    observedAt: '2026-08-20T16:02:44.676Z',
  }],
}

function post(overrides: Partial<ExistingWordpressPost> = {}): ExistingWordpressPost {
  return {
    postId: 42,
    postType: 'page',
    title: 'See all of China, the way it deserves.',
    slug: 'home',
    excerpt: '',
    content: '<main>Example escorted tours across Asia.</main>',
    status: 'publish',
    link: PAGE_URL,
    modified: VERSION,
    seoTitle: OLD_TITLE,
    seoDescription: 'Discover escorted China tours from New Zealand with Example Tours.',
    ...overrides,
  }
}

function input(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const validatedDiffHash = canonicalDiffHash([
    { field: 'meta_title', before: OLD_TITLE, after: NEW_TITLE, changed: true },
  ])
  const intents = [
    {
      field: 'meta_title',
      proposedValue: NEW_TITLE,
      semanticIntent: { known: true, value: 'Reserve China ownership for /china-tours.' },
    },
  ]
  const doNotTouch = ['meta_description', 'content_html']
  const authorizedAction = {
    page_url: PAGE_URL,
    page_version_token: VERSION,
    validated_diff_hash: validatedDiffHash,
    intents,
    do_not_touch: doNotTouch,
    wordpress_post_id: 42,
    wordpress_post_type: 'page',
  }
  const unsignedAuthorizationContext = {
    client_id: CLIENT,
    validation_passed: true,
    target_page_url: PAGE_URL,
    page_ledger_ref: 'client_site_pages:page-42',
    source_binding: {
      client_source: `clients:${CLIENT}`,
      page_ledger_source: 'client_site_pages:page-42',
      connection_source: 'cms_connections:wp-42',
      post_source: 'wordpress:page:42@2026-08-20T01:00:00.000Z',
    },
    authorized_action: authorizedAction,
    action_digest: canonicalHashOfInput(authorizedAction),
    growth_lineage: {
      finding_hash: canonicalHashOfInput(finding),
      finding,
      prescription: { goal: 'clarify URL ownership' },
    },
    source_receipt: {
      evidence_source_id: EVIDENCE_SOURCE_ID,
      provider: 'gsc',
      query: 'china tours',
    },
    finding_ref: 'gsc:example:nz:escorted-tours',
    market: 'NZ',
    query: 'china tours',
  }
  return {
    page_url: PAGE_URL,
    page_version_token: VERSION,
    validated_diff_hash: validatedDiffHash,
    intents,
    do_not_touch: doNotTouch,
    wordpress_post_id: 42,
    wordpress_post_type: 'page',
    authorization_context: {
      ...unsignedAuthorizationContext,
      authorization_proof: signProof(unsignedAuthorizationContext as unknown as GrowthJsonValue),
    },
    ...overrides,
  }
}

function ctx(): AuthorizedExecutionContext {
  return {
    decisionId: 'decision-1',
    runId: 'run-1',
    clientId: CLIENT,
    actionKey: 'page.apply_wordpress_optimization_request',
    actionVersion: 1,
    policyVersion: 1,
    costCapUsd: null,
    idempotencyKey: 'idem-1',
    expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}

function step(
  stepKey: string,
  runInput: Record<string, unknown>,
  priorOutputs: Readonly<Record<string, Record<string, unknown>>> = {},
): CapabilityStepContext {
  return {
    ctx: ctx(),
    stepKey,
    attempt: 1,
    idempotencyKey: `idem-1:${stepKey}`,
    priorOutputs,
    runInput,
  }
}

function deps(reads: ExistingWordpressPost[] = [post()]): {
  deps: PageApplyWordpressDeps
  readPost: ReturnType<typeof vi.fn>
  updatePost: ReturnType<typeof vi.fn>
} {
  const queue = [...reads]
  const readPost = vi.fn(async () => queue.shift() ?? reads[reads.length - 1] ?? post())
  const updatePost = vi.fn(async (_config, update, expectedModified) => ({
    postId: update.postId,
    postType: update.postType ?? 'post',
    link: PAGE_URL,
    previousModified: expectedModified,
    modified: AFTER_VERSION,
    updatedFields: [
      ...(update.seoTitle !== undefined ? ['seoTitle'] : []),
      ...(update.seoDescription !== undefined ? ['seoDescription'] : []),
    ],
  }))
  return {
    deps: {
      resolveConnection: async () => ({
        config: { siteUrl: 'https://customer-zero.example.nz', username: 'me', appPassword: 'hidden' },
        status: 'connected',
        yoastPluginInstalled: true,
      }),
      readPost,
      updatePost,
      supportsAtomicApply: async () => true,
      verifyAuthorizationProof: verifyProof,
    },
    readPost,
    updatePost,
  }
}

async function preparedOutput(fake: ReturnType<typeof deps>, runInput = input()) {
  const capability = createPageApplyWordpressCapability(fake.deps)
  const prepared = await capability.steps.prepare(step('prepare', runInput))
  return { capability, output: prepared.output }
}

describe('WordPress Page Apply v2 · prepare', () => {
  it('re-reads the tenant connection and produces a version-pinned before/after snapshot', async () => {
    const fake = deps()
    const { output } = await preparedOutput(fake)

    expect(output).toMatchObject({
      page_url: PAGE_URL,
      post_id: 42,
      post_type: 'page',
      before_modified: VERSION,
      before: { seo_title: OLD_TITLE },
      after: { seo_title: NEW_TITLE },
    })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('rejects a stale WordPress modified token before any write', async () => {
    const fake = deps([post({ modified: AFTER_VERSION })])
    await expect(preparedOutput(fake)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      humanReason: expect.stringMatching(/stale_snapshot/),
    })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('rejects post id / URL substitution before any write', async () => {
    const fake = deps([post({ link: 'https://customer-zero.example.nz/china-tours/' })])
    await expect(preparedOutput(fake)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('rejects a target that is no longer published', async () => {
    const fake = deps([post({ status: 'draft' })])
    await expect(preparedOutput(fake)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('rejects body mutation until full-content rollback is governed', async () => {
    const fake = deps()
    await expect(preparedOutput(fake, input({
      intents: [{
        field: 'content_html',
        proposedValue: '<main>changed</main>',
        semanticIntent: { known: false, reason: 'not_applicable' },
      }],
    }))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('rejects a caller-supplied diff hash that does not match the live snapshot', async () => {
    const fake = deps()
    await expect(preparedOutput(fake, input({ validated_diff_hash: 'bad-hash' })))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('rejects forged or incomplete authorization context before any provider read/write', async () => {
    const fake = deps()
    await expect(preparedOutput(fake, input({
      authorization_context: {
        client_id: CLIENT,
        validation_passed: false,
        target_page_url: PAGE_URL,
        page_ledger_ref: 'client_site_pages:page-42',
        source_receipt: { provider: 'gsc' },
      },
    }))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fake.readPost).not.toHaveBeenCalled()
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('rejects when displayed authorization context and actual intents differ', async () => {
    const fake = deps()
    await expect(preparedOutput(fake, input({
      intents: [{
        field: 'meta_title',
        proposedValue: 'A different hidden title',
        semanticIntent: { known: true, value: 'smuggled' },
      }],
    }))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fake.readPost).not.toHaveBeenCalled()
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('rejects a self-consistent context that lacks the server HMAC proof', async () => {
    const fake = deps()
    const runInput = input()
    const context = runInput.authorization_context as Record<string, unknown>
    await expect(preparedOutput(fake, {
      ...runInput,
      authorization_context: { ...context, authorization_proof: 'hmac-sha256:' + '0'.repeat(64) },
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fake.readPost).not.toHaveBeenCalled()
    expect(fake.updatePost).not.toHaveBeenCalled()
  })
})

describe('WordPress Page Apply v2 · apply and verify', () => {
  it('checks for drift again, updates only the approved meta field, then verifies by reread', async () => {
    const fake = deps([
      post(),
      post(),
      post({ modified: AFTER_VERSION, seoTitle: NEW_TITLE }),
    ])
    const runInput = input()
    const { capability, output: prepare } = await preparedOutput(fake, runInput)
    const applied = await capability.steps.apply(step('apply', runInput, { prepare }))
    const verified = await capability.steps.verify(step('verify', runInput, {
      prepare,
      apply: applied.output,
    }))

    expect(fake.updatePost).toHaveBeenCalledTimes(1)
    expect(fake.updatePost.mock.calls[0][1]).toMatchObject({
      postId: 42,
      postType: 'page',
      seoTitle: NEW_TITLE,
    })
    expect(fake.updatePost.mock.calls[0][1]).not.toHaveProperty('seoDescription')
    expect(fake.updatePost.mock.calls[0][2]).toBe(VERSION)
    expect(fake.updatePost.mock.calls[0][3]).toEqual({ seoTitle: OLD_TITLE })
    expect(verified.verification).toMatchObject({
      method: 'page_apply_integrity',
      passed: true,
    })
    expect(verified.output).toMatchObject({ provider: 'wordpress' })
  })

  it('rejects a change that lands between prepare and apply', async () => {
    const fake = deps([post(), post({ modified: AFTER_VERSION })])
    const runInput = input()
    const { capability, output: prepare } = await preparedOutput(fake, runInput)

    await expect(capability.steps.apply(step('apply', runInput, { prepare })))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('rechecks Yoast readiness at apply and performs no write when it disappears', async () => {
    const fake = deps([post()])
    const resolveConnection = vi.fn()
      .mockResolvedValueOnce({
        config: { siteUrl: 'https://customer-zero.example.nz', username: 'me', appPassword: 'hidden' },
        status: 'connected',
        yoastPluginInstalled: true,
      })
      .mockResolvedValueOnce({
        config: { siteUrl: 'https://customer-zero.example.nz', username: 'me', appPassword: 'hidden' },
        status: 'connected',
        yoastPluginInstalled: false,
      })
    const capability = createPageApplyWordpressCapability({ ...fake.deps, resolveConnection })
    const runInput = input()
    const prepared = await capability.steps.prepare(step('prepare', runInput))

    await expect(capability.steps.apply(step('apply', runInput, { prepare: prepared.output })))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('refuses apply when the provider-side atomic endpoint disappears', async () => {
    const fake = deps([post()])
    const supportsAtomicApply = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const capability = createPageApplyWordpressCapability({
      ...fake.deps,
      supportsAtomicApply,
    })
    const runInput = input()
    const prepared = await capability.steps.prepare(step('prepare', runInput))

    await expect(capability.steps.apply(step('apply', runInput, { prepare: prepared.output })))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })
})

describe('WordPress Page Apply v2 · rollback', () => {
  const applyOutput = {
    post_id: 42,
    post_type: 'page',
    link: PAGE_URL,
    modified: AFTER_VERSION,
    previous_modified: VERSION,
    updated_fields: ['seoTitle'],
  }

  it('restores the before snapshot only when the current value is exactly the approved after value', async () => {
    const fake = deps([post(), post({ modified: AFTER_VERSION, seoTitle: NEW_TITLE }), post()])
    const runInput = input()
    const { capability, output: prepare } = await preparedOutput(fake, runInput)
    const result = await capability.rollback!(step('rollback', runInput), {
      prepare,
      apply: applyOutput,
    })

    expect(result).toMatchObject({ ok: true, rollbackKind: 'provider_native' })
    expect(fake.updatePost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ postId: 42, seoTitle: OLD_TITLE }),
      AFTER_VERSION,
      { seoTitle: NEW_TITLE },
    )
    expect(fake.updatePost.mock.calls[0][1]).not.toHaveProperty('seoDescription')
  })

  it('does not overwrite third-party drift during rollback', async () => {
    const fake = deps([post(), post({ modified: AFTER_VERSION, seoTitle: 'A human changed this' })])
    const runInput = input()
    const { capability, output: prepare } = await preparedOutput(fake, runInput)
    const result = await capability.rollback!(step('rollback', runInput), {
      prepare,
      apply: applyOutput,
    })

    expect(result).toMatchObject({
      ok: false,
      rollbackKind: 'provider_native',
      detail: { reason: 'third_party_drift_detected' },
    })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('is idempotent when the page is already back at the before snapshot', async () => {
    const fake = deps([post(), post()])
    const runInput = input()
    const { capability, output: prepare } = await preparedOutput(fake, runInput)
    const result = await capability.rollback!(step('rollback', runInput), {
      prepare,
      apply: applyOutput,
    })

    expect(result).toMatchObject({ ok: true, rollbackKind: 'noop' })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('only records noop without an apply output when a reread proves the page is still before', async () => {
    const fake = deps([post()])
    const runInput = input()
    const { capability, output: prepare } = await preparedOutput(fake, runInput)
    const result = await capability.rollback!(step('rollback', runInput), { prepare })

    expect(result).toMatchObject({
      ok: true,
      rollbackKind: 'noop',
      detail: { reason: 'already_at_before_snapshot' },
    })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('marks apply outcome unknown when no apply receipt exists and the page is no longer before', async () => {
    const fake = deps([post(), post({ modified: AFTER_VERSION, seoTitle: NEW_TITLE })])
    const runInput = input()
    const { capability, output: prepare } = await preparedOutput(fake, runInput)
    const result = await capability.rollback!(step('rollback', runInput), { prepare })

    expect(result).toMatchObject({
      ok: false,
      rollbackKind: 'provider_native',
      detail: { reason: 'apply_outcome_unknown' },
    })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })

  it('does not rollback when the same after value was saved again with a new modified token', async () => {
    const fake = deps([post(), post({ modified: '2026-08-20T03:00:00.000Z', seoTitle: NEW_TITLE })])
    const runInput = input()
    const { capability, output: prepare } = await preparedOutput(fake, runInput)
    const result = await capability.rollback!(step('rollback', runInput), {
      prepare,
      apply: applyOutput,
    })

    expect(result).toMatchObject({
      ok: false,
      detail: { reason: 'post_apply_version_drift_detected' },
    })
    expect(fake.updatePost).not.toHaveBeenCalled()
  })
})
