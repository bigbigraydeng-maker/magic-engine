import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('../changelog-window', () => ({
  loadChangelogWindow: vi.fn(),
  nzDateString: () => '23 Sep 2026',
}))
vi.mock('../draft-post', () => ({ draftLinkedinPost: vi.fn(), validateDraftFormat: vi.fn(() => []) }))
vi.mock('../sensitive-filter', () => ({
  loadClientKeywords: vi.fn(async () => []),
  findSensitiveMatches: vi.fn(() => []),
}))
vi.mock('@/lib/flywheel/social-post-publish', () => ({
  scheduleSocialPost: vi.fn(),
  resolveBoundPublerAccount: vi.fn(),
}))
vi.mock('@/lib/content/content-guard', () => ({
  runContentGuard: vi.fn(),
  contentGuardSnapshot: (g: { status: string; needsHumanReview: boolean }) => ({
    status: g.status,
    needs_human_review: g.needsHumanReview,
  }),
}))

import { runLinkedinProgressPost } from '../run'
import { supabaseAdmin } from '@/lib/supabase'
import { loadChangelogWindow } from '../changelog-window'
import { draftLinkedinPost } from '../draft-post'
import { scheduleSocialPost, resolveBoundPublerAccount } from '@/lib/flywheel/social-post-publish'
import { runContentGuard } from '@/lib/content/content-guard'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockWindow = vi.mocked(loadChangelogWindow)
const mockDraft = vi.mocked(draftLinkedinPost)
const mockPublish = vi.mocked(scheduleSocialPost)
const mockAccount = vi.mocked(resolveBoundPublerAccount)
const mockGuard = vi.mocked(runContentGuard)

const cronRun = { finish: vi.fn(async () => undefined) }
const inserted: Record<string, unknown>[] = []

/** content_posts stub: dedupe reads return empty, inserts are captured. */
function fakeContentPosts() {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'limit', 'update']) chain[m] = vi.fn(() => chain)
  chain.insert = vi.fn((row: Record<string, unknown>) => {
    inserted.push(row)
    return chain
  })
  chain.single = vi.fn(async () => ({ data: { id: 'new-post' }, error: null }))
  chain.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(onOk, onErr)
  return chain
}

const guardResult = (over: Record<string, unknown> = {}) => ({
  status: 'pass',
  needsHumanReview: false,
  targetLanguage: 'en',
  languageFindings: [],
  clicheProbability: 0.1,
  judgeError: null,
  dimensions: [],
  config: { clicheThreshold: 0.8, maxEmbeddedLatinWords: 3, maxEmbeddedCjkChars: 0 },
  ...over,
}) as unknown as Awaited<ReturnType<typeof runContentGuard>>

beforeEach(() => {
  inserted.length = 0
  vi.clearAllMocks()
  process.env.LINKEDIN_PROGRESS_POST_ENABLED = 'true'
  mockFrom.mockImplementation(() => fakeContentPosts() as never)
  mockWindow.mockResolvedValue({
    cutoffDate: '2026-09-16',
    entries: [{ date: '2026-09-20', heading: 'shipped a thing', body: 'details' }],
  } as never)
  mockDraft.mockResolvedValue('An English post about what shipped this week.')
  mockAccount.mockResolvedValue({ id: 'acct-1' } as never)
  mockPublish.mockResolvedValue({ ok: true, publerJobId: 'job-1', scheduledAt: null } as never)
})

afterEach(() => { delete process.env.LINKEDIN_PROGRESS_POST_ENABLED })

describe('runLinkedinProgressPost — pre-publish content guard backstop', () => {
  it('a flagged draft is parked for a human, never published', async () => {
    mockGuard.mockResolvedValue(guardResult({ status: 'fail', needsHumanReview: true }))

    const res = await runLinkedinProgressPost(cronRun as never, new Date('2026-09-23T05:15:00Z'))
    const body = await res.json()

    expect(mockPublish).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].status).toBe('draft')
    expect((inserted[0].generation_context_snapshot as { reason: string }).reason).toBe('content_guard_flagged')
    expect(body.guardFlagged).toBe(true)
  })

  it('an unavailable judge parks it too — a check that never ran is not a pass', async () => {
    mockGuard.mockResolvedValue(guardResult({ status: 'unavailable', needsHumanReview: true, judgeError: 'quota exceeded' }))

    await runLinkedinProgressPost(cronRun as never, new Date('2026-09-23T05:15:00Z'))

    expect(mockPublish).not.toHaveBeenCalled()
    expect((inserted[0].generation_context_snapshot as { reason: string }).reason).toBe('content_guard_flagged')
  })

  it('a clean draft still publishes, and carries its guard receipt', async () => {
    mockGuard.mockResolvedValue(guardResult())

    await runLinkedinProgressPost(cronRun as never, new Date('2026-09-23T05:15:00Z'))

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].status).toBe('approved')
    expect(inserted[0].generation_context_snapshot).toMatchObject({
      content_guard: { status: 'pass', needs_human_review: false },
    })
  })

  it('the guard runs against the English target, not a language guessed from Chinese source material', async () => {
    mockGuard.mockResolvedValue(guardResult())

    await runLinkedinProgressPost(cronRun as never, new Date('2026-09-23T05:15:00Z'))

    expect(mockGuard).toHaveBeenCalledWith(
      'An English post about what shipped this week.',
      { targetLanguage: 'en' },
    )
  })
})
