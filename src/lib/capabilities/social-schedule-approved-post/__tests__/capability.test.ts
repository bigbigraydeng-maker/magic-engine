import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { mapCandidateIdentity, MAPPING_TABLE } from '@/lib/action-bridge'
import { ACTION_REGISTRY, LOCAL_ONLY_ACTION_KEYS } from '@/lib/kernel/registry'
import { approveAndRun, runAction } from '@/lib/kernel/runner'
import { CLIENT_A, GOAL_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import type { SocialPublishingProvider } from '@/lib/social/social-publishing-provider'
import { createLocalSocialScheduleCapability } from '..'

const KEY = 'social.schedule_approved_post'
const TEXT = 'One governed social post.'
const HASH = createHash('sha256').update(TEXT).digest('hex')
const INPUT = {
  content_post_id: 'social-content-1',
  account_ref: 'account-1',
  platform: 'facebook',
  text: TEXT,
  approved_content_sha256: HASH,
  scheduled_at: '2026-08-22T02:00:00.000Z',
}

function fakeProvider(overrides: Partial<SocialPublishingProvider> = {}) {
  const identity = {
    clientId: CLIENT_A,
    contentPostId: INPUT.content_post_id,
    providerPostId: 'provider-post-1',
    accountRef: INPUT.account_ref,
    platform: INPUT.platform,
  }
  const provider: SocialPublishingProvider = {
    providerId: 'fake-social',
    schedule: vi.fn().mockResolvedValue({
      providerJobId: 'job-1',
      providerPostId: identity.providerPostId,
      accountRef: identity.accountRef,
      platform: identity.platform,
      contentSha256: HASH,
      scheduledAt: INPUT.scheduled_at,
    }),
    queryPublication: vi.fn().mockResolvedValue({
      ...identity,
      publicationStatus: 'scheduled',
      observedAt: '2026-08-22T02:01:00.000Z',
      publishedAt: null,
      contentSha256: HASH,
    }),
    cancel: vi.fn().mockResolvedValue({
      ...identity,
      cancellationStatus: 'cancelled',
      cancelledAt: '2026-08-22T02:02:00.000Z',
    }),
    readEngagement: vi.fn().mockResolvedValue({
      ...identity,
      observedAt: '2026-08-29T02:00:00.000Z',
      likes: 1,
      comments: 0,
      shares: 0,
    }),
    ...overrides,
  }
  return provider
}

function fixture(provider: unknown) {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: () => {
      const capability = createLocalSocialScheduleCapability({
        provider,
        gate: { enabled: true, scope: 'local_test' },
      })
      if (!capability) throw new Error('local social capability was not assembled')
      return { [KEY]: capability }
    },
    options: {
      policy: { action_key: KEY, mode: 'require_approval', spend_cap_per_run_usd: 0 },
    },
  })
}

function submission() {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'agent' as const,
    input: INPUT,
  }
}

function expectCalls(provider: SocialPublishingProvider, counts: readonly number[]) {
  expect(provider.schedule).toHaveBeenCalledTimes(counts[0])
  expect(provider.queryPublication).toHaveBeenCalledTimes(counts[1])
  expect(provider.cancel).toHaveBeenCalledTimes(counts[2])
  expect(provider.readEngagement).toHaveBeenCalledTimes(counts[3])
}

describe('Social Kernel local governed Action', () => {
  it('maps one exact Candidate identity to one exact ActionKey', () => {
    expect(MAPPING_TABLE.filter(
      (entry) => entry.domain === 'social' && entry.intent === 'publish_approved_post',
    )).toEqual([{
      domain: 'social', intent: 'publish_approved_post', actionKey: KEY,
    }])
    expect(mapCandidateIdentity({ domain: 'social', intent: 'publish_approved_post' }))
      .toEqual({ outcome: 'mapped', actionKey: KEY, actionVersion: 1 })
  })

  it('registers the contract but excludes it from production composition', async () => {
    expect(LOCAL_ONLY_ACTION_KEYS).toEqual([KEY])
    expect(ACTION_REGISTRY.get(KEY)).toMatchObject({
      sideEffect: 'outward',
      reversible: true,
      providerIdempotency: 'unsupported',
      retryPolicy: { maxAttempts: 1 },
      outwardAuthorization: { requiresHumanApproval: true, rollback: 'provider_native' },
    })
    expect(createLocalSocialScheduleCapability({
      provider: fakeProvider(), gate: { enabled: false, scope: 'disabled' },
    })).toBeNull()
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect(createLocalSocialScheduleCapability({
        provider: fakeProvider(), gate: { enabled: true, scope: 'local_test' },
      })).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
    const { createCapabilities } = await import('@/lib/capabilities')
    expect(createCapabilities({} as never)).not.toHaveProperty(KEY)
  })

  it('makes zero provider calls before approval, then schedules exactly once', async () => {
    const provider = fakeProvider()
    const f = fixture(provider)
    const pending = await runAction(f.kernel, submission())
    expect(pending.kind).toBe('pending_approval')
    expectCalls(provider, [0, 0, 0, 0])
    const done = await approveAndRun(f.kernel, pending.run.id, 'human@magiclab.test')
    expect(done.kind).toBe('succeeded')
    expectCalls(provider, [1, 1, 0, 0])
  })

  it('rejects invalid content before provider traffic with truthful noop rollback', async () => {
    const provider = fakeProvider()
    const f = fixture(provider)
    const pending = await runAction(f.kernel, {
      ...submission(), input: { ...INPUT, approved_content_sha256: 'b'.repeat(64) },
    })
    const done = await approveAndRun(f.kernel, pending.run.id, 'human@magiclab.test')
    expect(done.kind).toBe('dead_letter')
    expectCalls(provider, [0, 0, 0, 0])
    expect(f.tables.action_run_steps.find((step) => step.step_key === 'rollback'))
      .toMatchObject({ status: 'skipped', output: { detail: { reason: 'schedule_not_reached' } } })
  })

  it('fails closed without cancel support and never schedules', async () => {
    const complete = fakeProvider()
    const f = fixture({ ...complete, cancel: undefined })
    const pending = await runAction(f.kernel, submission())
    const done = await approveAndRun(f.kernel, pending.run.id, 'human@magiclab.test')
    expect(done.kind).toBe('dead_letter')
    expect(done.humanReason).toContain('NOT READY')
    expectCalls(complete, [0, 0, 0, 0])
  })

  it('fails closed without providerPostId and never invents a rollback target', async () => {
    const schedule = vi.fn().mockResolvedValue({
      providerJobId: 'job-without-post',
      accountRef: INPUT.account_ref,
      platform: INPUT.platform,
      contentSha256: HASH,
      scheduledAt: INPUT.scheduled_at,
    })
    const provider = fakeProvider({ schedule })
    const f = fixture(provider)
    const pending = await runAction(f.kernel, submission())
    const done = await approveAndRun(f.kernel, pending.run.id, 'human@magiclab.test')
    expect(done.kind).toBe('dead_letter')
    expectCalls(provider, [1, 0, 0, 0])
    expect(f.tables.action_run_steps.find((step) => step.step_key === 'rollback'))
      .toMatchObject({
        status: 'failed',
        output: { detail: { reason: 'exact_schedule_receipt_unavailable' } },
      })
  })

  it('rolls back only the exact post pinned by this run receipt', async () => {
    const queryPublication = vi.fn().mockResolvedValue({
      clientId: CLIENT_A,
      contentPostId: INPUT.content_post_id,
      providerPostId: 'foreign-post',
      accountRef: INPUT.account_ref,
      platform: INPUT.platform,
      publicationStatus: 'scheduled',
      observedAt: '2026-08-22T02:01:00.000Z',
      publishedAt: null,
      contentSha256: HASH,
    })
    const provider = fakeProvider({ queryPublication })
    const f = fixture(provider)
    const pending = await runAction(f.kernel, submission())
    const done = await approveAndRun(f.kernel, pending.run.id, 'human@magiclab.test')
    expect(done.kind).toBe('dead_letter')
    expectCalls(provider, [1, 1, 1, 0])
    expect(provider.cancel).toHaveBeenCalledWith({
      clientId: CLIENT_A,
      contentPostId: INPUT.content_post_id,
      providerPostId: 'provider-post-1',
      accountRef: INPUT.account_ref,
      platform: INPUT.platform,
    })
  })
})
