/** LOCAL SYNTHETIC orchestration proof. No live provider or production write. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sourceMocks = vi.hoisted(() => ({
  loadPage: vi.fn(),
  loadConnection: vi.fn(),
  githubConstructor: vi.fn(),
  listDirectory: vi.fn(),
  getFileContent: vi.fn(),
  loadRedlines: vi.fn(),
}))
vi.mock('@/lib/db/site-pages', () => ({ getSitePageForClient: sourceMocks.loadPage }))
vi.mock('@/lib/cms/connection-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/cms/connection-store')>(),
  getConnection: sourceMocks.loadConnection,
}))
vi.mock('@/lib/cms/github-client', () => ({
  GithubClient: class {
    constructor(token: string) { sourceMocks.githubConstructor(token) }
    listDirectory = sourceMocks.listDirectory
    getFileContent = sourceMocks.getFileContent
  },
}))
vi.mock('@/lib/db/client-redlines', () => ({
  loadTrustedClientRedlines: sourceMocks.loadRedlines,
}))

import { createDefaultDeps } from '@/lib/action-submission'
import { GOAL_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CTS_CLIENT_ID } from '@/lib/seo-meta/cts-meta-source'
import {
  triggerCtsGithubMetadataReferenceLoop,
  type CtsGithubReferenceLoopTriggerInput,
} from '..'

const PAGE_ID = 'c7500000-0000-4000-8000-000000000001'
const TARGET_URL = 'https://www.ctstours.co.nz/china-tours'
const EVIDENCE_PAGE = 'https://www.ctstours.co.nz/'
const CONTENT_PATH = 'src/lib/data/seo-pages.ts'
const SOURCE = `export const pages = [{
  slug: 'china-tours',
  title: 'China Tours | CTS Tours',
  description: 'Explore escorted China tours with CTS Tours.',
  h1: 'China Tours from New Zealand',
}]\n`
const ORIGINAL_PROOF = process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY
const ORIGINAL_ROLLOUT = process.env.CTS_GITHUB_METADATA_ACTION_ENABLED

function triggerInput(): CtsGithubReferenceLoopTriggerInput {
  return {
    pageId: PAGE_ID,
    gsc: {
      accessToken: 'local-synthetic-token',
      startDate: '2026-07-23',
      endDate: '2026-08-20',
      evidencePageUrl: EVIDENCE_PAGE,
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
      goalId: GOAL_A,
      orderingRationale: 'Test the smallest three-field intent distinction before considering body edits.',
      verification: {
        windowDays: 28,
        baseline: 'CTS NZ exact page×query window ending 2026-08-20',
        success: '/china-tours becomes the selected URL',
        failure: 'homepage remains the selected URL',
        indeterminate: 'privacy filtering or insufficient rows',
      },
    },
    kernel: { triggeredBy: 'human', rationale: 'LOCAL SYNTHETIC controlled trigger proof' },
  }
}

function gscResponse(rows: unknown[]): Response {
  return new Response(JSON.stringify({ rows }), { status: 200 })
}

beforeAll(() => {
  process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY =
    'local-cts-trigger-proof-secret-that-is-at-least-32-bytes'
  process.env.CTS_GITHUB_METADATA_ACTION_ENABLED = 'true'
})

afterAll(() => {
  if (ORIGINAL_PROOF === undefined) delete process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY
  else process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY = ORIGINAL_PROOF
  if (ORIGINAL_ROLLOUT === undefined) delete process.env.CTS_GITHUB_METADATA_ACTION_ENABLED
  else process.env.CTS_GITHUB_METADATA_ACTION_ENABLED = ORIGINAL_ROLLOUT
})

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  process.env.CTS_GITHUB_METADATA_ACTION_ENABLED = 'true'
  sourceMocks.loadPage.mockResolvedValue({
    id: PAGE_ID, client_id: CTS_CLIENT_ID, url: TARGET_URL,
  })
  sourceMocks.loadConnection.mockResolvedValue({
    connected: true,
    provider: 'github',
    repoOwner: 'bigbigraydeng-maker',
    repoName: 'chinatravel',
    branch: 'main',
    tokenHint: 'test',
    status: 'connected',
    lastError: null,
    lastTestedAt: '2026-08-20T14:00:00.000Z',
    contentPaths: [CONTENT_PATH],
    contentTargets: [],
    plainToken: 'not-a-real-token',
  })
  sourceMocks.listDirectory.mockResolvedValue([
    { name: 'seo-pages.ts', path: CONTENT_PATH, type: 'file' },
  ])
  sourceMocks.getFileContent.mockResolvedValue({ sha: 'cts-source-blob-sha', decodedContent: SOURCE })
  sourceMocks.loadRedlines.mockResolvedValue({
    redline: { available: true, phrases: ['guaranteed departure'] },
    source: `clients:${CTS_CLIENT_ID}:brand_redline_phrases+master_briefs:${CTS_CLIENT_ID}:avoid_words`,
  })
})

function fixture() {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: () => ({}),
    options: {
      policy: {
        client_id: CTS_CLIENT_ID,
        action_key: 'page.apply_cts_github_metadata_request',
        mode: 'require_approval',
      },
      goals: [{ id: GOAL_A, client_id: CTS_CLIENT_ID, title: 'Clarify CTS URL ownership' }],
    },
  })
}

describe('CTS controlled GSC → Kernel trigger', () => {
  it('performs one exact NZ read and pins its trusted receipt into pending approval', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(gscResponse([{
      keys: [EVIDENCE_PAGE, 'china tours'],
      clicks: 2,
      impressions: 195,
      ctr: 0.010256410256410256,
      position: 14.876923076923077,
    }]))
    const f = fixture()

    const result = await triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      triggerInput(),
    )

    expect(result).toMatchObject({ ok: true, outcome: 'pending_approval' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const request = fetchSpy.mock.calls[0]
    expect(request[1]?.headers).toMatchObject({ Authorization: 'Bearer local-synthetic-token' })
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      dimensions: ['page', 'query'],
      type: 'web',
      rowLimit: 250,
      dimensionFilterGroups: [{
        filters: [{ dimension: 'country', operator: 'equals', expression: 'nzl' }],
      }],
    })
    expect(String(request[0])).toContain('sc-domain%3Actstours.co.nz')
    expect(sourceMocks.loadPage).toHaveBeenCalledWith(CTS_CLIENT_ID, PAGE_ID)
    expect(sourceMocks.loadConnection).toHaveBeenCalledWith(CTS_CLIENT_ID)

    const run = f.tables.action_runs[0]
    expect(run).toMatchObject({
      client_id: CTS_CLIENT_ID,
      action_key: 'page.apply_cts_github_metadata_request',
      status: 'pending_approval',
      input: {
        page_url: TARGET_URL,
        headline: {
          proposedValue: 'Explore All China Tours',
          semanticIntent: 'Give the generic hub a collection-focused heading.',
        },
        authorization_context: {
          source_receipt: {
            provider: 'gsc',
            property: 'sc-domain:ctstours.co.nz',
            country: 'nzl',
            page: EVIDENCE_PAGE,
            query: 'china tours',
            clicks: 2,
            impressions: 195,
          },
          growth_lineage: {
            finding: { pillar: 'seo', severity: 'medium' },
          },
        },
      },
    })
    expect(JSON.stringify(run.input)).not.toContain('local-synthetic-token')
  })

  it('rejects a foreign evidence page before any GSC request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const f = fixture()
    const input = triggerInput()
    await expect(triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      { ...input, gsc: { ...input.gsc, evidencePageUrl: 'https://example.com/' } },
    )).resolves.toEqual({
      ok: false,
      reason: 'cts_trigger_not_ready',
      detail: 'gsc_scope_invalid',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sourceMocks.loadRedlines).not.toHaveBeenCalled()
    expect(f.tables.action_runs).toEqual([])
  })

  it('treats URL variants of the target page as the same page', async () => {
    const variant = 'http://ctstours.co.nz/china-tours/?source=gsc#top'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(gscResponse([{
      keys: [variant, 'china tours'],
      clicks: 0,
      impressions: 120,
      ctr: 0,
      position: 18,
    }]))
    const f = fixture()
    const input = triggerInput()
    await expect(triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      { ...input, gsc: { ...input.gsc, evidencePageUrl: variant } },
    )).resolves.toEqual({
      ok: false,
      reason: 'cts_trigger_not_ready',
      detail: 'evidence_target_same',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(f.tables.action_runs).toEqual([])
  })

  it('stops before GSC, source or Kernel when rollout is disabled', async () => {
    process.env.CTS_GITHUB_METADATA_ACTION_ENABLED = 'false'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const f = fixture()
    await expect(triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      triggerInput(),
    )).resolves.toEqual({
      ok: false,
      reason: 'cts_trigger_not_ready',
      detail: 'rollout_disabled',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sourceMocks.loadPage).not.toHaveBeenCalled()
    expect(sourceMocks.loadRedlines).not.toHaveBeenCalled()
    expect(f.tables.action_runs).toEqual([])
  })

  it('does not read GitHub or create a run when the exact page×query row is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(gscResponse([{
      keys: [EVIDENCE_PAGE, 'escorted tours'],
      clicks: 1,
      impressions: 20,
      ctr: 0.05,
      position: 9,
    }]))
    const f = fixture()
    await expect(triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      triggerInput(),
    )).resolves.toEqual({
      ok: false,
      reason: 'cts_trigger_not_ready',
      detail: 'gsc_row_not_found',
    })
    expect(sourceMocks.loadPage).not.toHaveBeenCalled()
    expect(f.tables.action_runs).toEqual([])
  })

  it('stops before GSC and source reads when authoritative redlines are unavailable', async () => {
    sourceMocks.loadRedlines.mockResolvedValue({
      redline: { available: false, reason: 'tenant redline lookup failed' },
      source: `clients:${CTS_CLIENT_ID}:brand_redline_phrases`,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const f = fixture()
    await expect(triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      triggerInput(),
    )).resolves.toEqual({
      ok: false,
      reason: 'cts_trigger_not_ready',
      detail: 'redline_not_ready',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sourceMocks.loadPage).not.toHaveBeenCalled()
    expect(f.tables.action_runs).toEqual([])
  })

  it('fails closed with a safe stage when the redline read throws', async () => {
    sourceMocks.loadRedlines.mockRejectedValue(new Error('sensitive database detail'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const f = fixture()
    await expect(triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      triggerInput(),
    )).resolves.toEqual({
      ok: false,
      reason: 'cts_trigger_not_ready',
      detail: 'redline_not_ready',
      upstreamReason: 'read_failed',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(f.tables.action_runs).toEqual([])
  })

  it('fails closed with a safe stage when the GSC read throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sensitive provider detail'))
    const f = fixture()
    await expect(triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      triggerInput(),
    )).resolves.toEqual({
      ok: false,
      reason: 'cts_trigger_not_ready',
      detail: 'gsc_read_failed',
    })
    expect(sourceMocks.loadPage).not.toHaveBeenCalled()
    expect(f.tables.action_runs).toEqual([])
  })

  it('fails closed on duplicate exact rows instead of selecting one', async () => {
    const row = {
      keys: [EVIDENCE_PAGE, 'china tours'],
      clicks: 2,
      impressions: 195,
      ctr: 0.010256410256410256,
      position: 14.876923076923077,
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(gscResponse([row, row]))
    const f = fixture()
    await expect(triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      triggerInput(),
    )).resolves.toEqual({
      ok: false,
      reason: 'cts_trigger_not_ready',
      detail: 'gsc_row_ambiguous',
    })
    expect(sourceMocks.loadPage).not.toHaveBeenCalled()
    expect(f.tables.action_runs).toEqual([])
  })

  it('uses authoritative redlines to stop a matching proposal before Kernel submission', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(gscResponse([{
      keys: [EVIDENCE_PAGE, 'china tours'],
      clicks: 2,
      impressions: 195,
      ctr: 0.010256410256410256,
      position: 14.876923076923077,
    }]))
    const f = fixture()
    const input = triggerInput()
    const result = await triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      {
        ...input,
        proposal: {
          ...input.proposal,
          title: 'Guaranteed Departure China Tours | CTS Tours',
        },
      },
    )
    expect(result).toEqual({
      ok: false,
      reason: 'cts_trigger_not_ready',
      detail: 'preparation_not_ready',
      upstreamReason: 'validation_failed',
    })
    expect(f.tables.action_runs).toEqual([])
  })

  it('applies authoritative redlines to H1 before Kernel submission', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(gscResponse([{
      keys: [EVIDENCE_PAGE, 'china tours'],
      clicks: 2,
      impressions: 195,
      ctr: 0.010256410256410256,
      position: 14.876923076923077,
    }]))
    const f = fixture()
    const input = triggerInput()
    const result = await triggerCtsGithubMetadataReferenceLoop(
      { caller: createDefaultDeps(f.kernel) },
      {
        ...input,
        proposal: { ...input.proposal, h1: 'Guaranteed Departure China Tours' },
      },
    )
    expect(result).toEqual({
      ok: false,
      reason: 'cts_trigger_not_ready',
      detail: 'preparation_not_ready',
      upstreamReason: 'validation_failed',
    })
    expect(f.tables.action_runs).toEqual([])
  })
})
