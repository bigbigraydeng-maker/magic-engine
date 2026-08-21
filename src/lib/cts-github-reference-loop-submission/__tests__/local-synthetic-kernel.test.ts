/**
 * LOCAL SYNTHETIC proof only.
 *
 * The GSC row uses the exact CTS NZ receipt shape and previously observed
 * metrics, but this test performs no live GSC/GitHub/database operation.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const trustedSourceMocks = vi.hoisted(() => ({
  loadPage: vi.fn(),
  loadConnection: vi.fn(),
  githubConstructor: vi.fn(),
  listDirectory: vi.fn(),
  getFileContent: vi.fn(),
  loadRedlines: vi.fn(),
}))
vi.mock('@/lib/db/site-pages', () => ({ getSitePageForClient: trustedSourceMocks.loadPage }))
vi.mock('@/lib/cms/connection-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/cms/connection-store')>(),
  getConnection: trustedSourceMocks.loadConnection,
}))
vi.mock('@/lib/cms/github-client', () => ({
  GithubClient: class {
    constructor(token: string) { trustedSourceMocks.githubConstructor(token) }
    listDirectory = trustedSourceMocks.listDirectory
    getFileContent = trustedSourceMocks.getFileContent
  },
}))
vi.mock('@/lib/db/client-redlines', () => ({
  loadTrustedClientRedlines: trustedSourceMocks.loadRedlines,
}))
import { createDefaultDeps } from '@/lib/action-submission'
import { mapCandidateIdentity } from '@/lib/action-bridge'
import {
  createPageApplyCtsGithubCapability,
} from '@/lib/capabilities/page-apply-cts-github'
import type { CtsGithubClient } from '@/lib/capabilities/page-apply-cts-github/deps'
import {
  loadTenantBoundCtsGithubSource,
  type TenantBoundCtsGithubSource,
} from '@/lib/capabilities/page-apply-cts-github/source'
import { prepareCtsGithubReferenceLoop } from '@/lib/cts-github-reference-loop'
import {
  triggerCtsGithubMetadataReferenceLoop,
  type CtsGithubReferenceLoopTriggerDeps,
} from '@/lib/cts-github-reference-loop-trigger'
import {
  createGscPageQueryEvidenceReceipt,
  fetchGscPageQueryReport,
  type GscPageQueryEvidenceReceipt,
} from '@/lib/gsc/client'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { GOAL_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { approveAndRun } from '@/lib/kernel/runner'
import { listPendingApprovals } from '@/lib/kernel-approval/service'
import { CTS_CLIENT_ID, inspectCtsIntentForSlug } from '@/lib/seo-meta/cts-meta-source'

const PAGE_ID = 'c7500000-0000-4000-8000-000000000001'
const PAGE_URL = 'https://www.ctstours.co.nz/china-tours'
const GSC_PAGE = 'https://www.ctstours.co.nz/'
const REPO_OWNER = 'bigbigraydeng-maker'
const REPO_NAME = 'chinatravel'
const DEFAULT_BRANCH = 'main'
const CONTENT_PATH = 'src/lib/data/seo-pages.ts'
const ENTRY_SLUG = 'china-tours'
const BLOB_SHA = 'cts-source-blob-sha'
const BEFORE_TITLE = 'China Tours | CTS Tours'
const BEFORE_DESCRIPTION = 'Explore escorted China tours with CTS Tours.'
const AFTER_TITLE = 'China Tours & Holiday Packages | CTS Tours'
const AFTER_DESCRIPTION = 'Explore the complete CTS collection of escorted, private and special-interest China tours.'
const BEFORE_H1 = 'China Tours'
const AFTER_H1 = 'Explore All China Tours'
const SOURCE = `export const pages = [
  {
    slug: '${ENTRY_SLUG}',
    title: '${BEFORE_TITLE}',
    description: '${BEFORE_DESCRIPTION}',
    h1: '${BEFORE_H1}',
  },
]\n`

const ORIGINAL_PROOF_KEY = process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY
const ORIGINAL_ROLLOUT = process.env.CTS_GITHUB_METADATA_ACTION_ENABLED
let receipt: GscPageQueryEvidenceReceipt
let source: TenantBoundCtsGithubSource

beforeAll(async () => {
  process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY =
    'local-cts-github-proof-secret-that-is-at-least-32-bytes'
  process.env.CTS_GITHUB_METADATA_ACTION_ENABLED = 'true'

  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    rows: [{
      keys: [GSC_PAGE, 'china tours'],
      clicks: 2,
      impressions: 195,
      ctr: 0.010256410256410256,
      position: 14.876923076923077,
    }],
  }), { status: 200 }))
  const params = {
    accessToken: 'local-synthetic-token',
    siteUrl: 'sc-domain:ctstours.co.nz',
    startDate: '2026-07-23',
    endDate: '2026-08-20',
    country: 'nzl',
  }
  const [row] = await fetchGscPageQueryReport(params)
  receipt = createGscPageQueryEvidenceReceipt(params, row)
  fetchSpy.mockRestore()

  trustedSourceMocks.loadPage.mockResolvedValue({
    id: PAGE_ID, client_id: CTS_CLIENT_ID, url: PAGE_URL,
  })
  trustedSourceMocks.loadConnection.mockResolvedValue({
    connected: true,
    provider: 'github',
    repoOwner: REPO_OWNER,
    repoName: REPO_NAME,
    branch: DEFAULT_BRANCH,
    tokenHint: 'test',
    status: 'connected',
    lastError: null,
    lastTestedAt: '2026-08-20T14:00:00.000Z',
    contentPaths: [CONTENT_PATH],
    contentTargets: [],
    plainToken: 'not-a-real-token',
  })
  trustedSourceMocks.listDirectory.mockResolvedValue([{
    name: 'seo-pages.ts', path: CONTENT_PATH, type: 'file',
  }])
  trustedSourceMocks.getFileContent.mockResolvedValue({ sha: BLOB_SHA, decodedContent: SOURCE })
  trustedSourceMocks.loadRedlines.mockResolvedValue({
    redline: { available: true, phrases: [] },
    source: `clients:${CTS_CLIENT_ID}:brand_redline_phrases+master_briefs:${CTS_CLIENT_ID}:avoid_words`,
  })
  const loaded = await loadTenantBoundCtsGithubSource({
    clientId: CTS_CLIENT_ID,
    pageId: PAGE_ID,
  })
  if (!loaded.ok) throw new Error(loaded.reason)
  source = loaded.source
})

afterAll(() => {
  if (ORIGINAL_PROOF_KEY === undefined) delete process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY
  else process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY = ORIGINAL_PROOF_KEY
  if (ORIGINAL_ROLLOUT === undefined) delete process.env.CTS_GITHUB_METADATA_ACTION_ENABLED
  else process.env.CTS_GITHUB_METADATA_ACTION_ENABLED = ORIGINAL_ROLLOUT
})

function preparation() {
  const finding = {
    pillar: 'seo',
    severity: 'high',
    statement: 'The query “china tours” is dispersed across CTS URLs; the generic /china-tours hub is a governed intent-differentiation candidate.',
    evidence: [{
      source: { kind: 'gsc', sourceId: receipt.evidence_source_id },
      observedAt: receipt.collected_at,
      rawLocator: { known: true, value: 'authorized-gsc-receipt:cts-nz-page-query' },
      interpretation: { known: true, value: { parserVersion: 'gsc-page-query-v1' } },
      confidence: { known: true, value: 1 },
    }],
  } as const
  const result = prepareCtsGithubReferenceLoop({
    clientId: CTS_CLIENT_ID,
    source,
    sourceReceipt: receipt,
    finding,
    prescription: {
      goalId: { known: true, value: GOAL_A },
      covers: [finding],
      notDoing: [{ statement: 'Do not change body content.', reason: 'Metadata-only authorization.' }],
      orderingRationale: 'Test the smallest reversible three-field intent distinction for the generic hub.',
    },
    findingRefs: [`gsc:${receipt.evidence_source_id}`],
    intents: [
      {
        field: 'meta_title',
        proposedValue: AFTER_TITLE,
        semanticIntent: { known: true, value: 'Differentiate the generic collection from the NZ-specific landing page.' },
      },
      {
        field: 'meta_description',
        proposedValue: AFTER_DESCRIPTION,
        semanticIntent: { known: true, value: 'Describe the range of tour formats without changing body copy.' },
      },
    ],
    headline: {
      proposedValue: AFTER_H1,
      semanticIntent: 'Give the generic hub a collection-focused heading.',
    },
    verification: {
      metricRef: 'gsc.page_query.url_ownership',
      windowDays: 28,
      baseline: 'CTS NZ exact page×query receipt ending 2026-08-20',
      criteria: {
        success: '/china-tours becomes the selected URL for china tours',
        failure: 'homepage remains the selected URL',
        indeterminate: 'privacy filtering or insufficient impressions prevents comparison',
      },
    },
    redline: { available: true, phrases: [] },
    redlineSource: 'client-policy:cts:metadata-only',
  })
  if (!result.ok) throw new Error(`${result.reason}:${result.detail ?? ''}`)
  expect(result.ok).toBe(true)
  return result.preparation
}

async function submitCtsGithubReferenceLoop(
  deps: CtsGithubReferenceLoopTriggerDeps,
  input: { readonly preparation?: unknown; readonly kernelMeta: {
    readonly clientId?: string
    readonly purpose?: string
    readonly goalId?: string | null
    readonly triggeredBy: 'signal' | 'schedule' | 'human' | 'agent' | 'run'
    readonly triggeredByRef?: string | null
    readonly rationale?: string | null
    readonly correlationId?: string
  } },
) {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    rows: [{
      keys: [GSC_PAGE, 'china tours'],
      clicks: 2,
      impressions: 195,
      ctr: 0.010256410256410256,
      position: 14.876923076923077,
    }],
  }), { status: 200 }))
  try {
    return await triggerCtsGithubMetadataReferenceLoop(deps, {
      pageId: PAGE_ID,
      gsc: {
        accessToken: 'local-synthetic-token',
        startDate: '2026-07-23',
        endDate: '2026-08-20',
        evidencePageUrl: GSC_PAGE,
        query: 'china tours',
      },
      proposal: {
        title: AFTER_TITLE,
        description: AFTER_DESCRIPTION,
        h1: AFTER_H1,
        titleRationale: 'Differentiate the generic collection from the NZ-specific landing page.',
        descriptionRationale: 'Describe the range of tour formats without changing body copy.',
        h1Rationale: 'Give the generic hub a collection-focused heading.',
      },
      growth: {
        goalId: input.kernelMeta.goalId,
        orderingRationale: 'Test the smallest reversible three-field intent distinction for the generic hub.',
        verification: {
          windowDays: 28,
          baseline: 'CTS NZ exact page×query receipt ending 2026-08-20',
          success: '/china-tours becomes the selected URL for china tours',
          failure: 'homepage remains the selected URL',
          indeterminate: 'privacy filtering or insufficient impressions prevents comparison',
        },
      },
      kernel: {
        triggeredBy: input.kernelMeta.triggeredBy,
        triggeredByRef: input.kernelMeta.triggeredByRef,
        rationale: input.kernelMeta.rationale,
        correlationId: input.kernelMeta.correlationId,
      },
    })
  } finally {
    fetchSpy.mockRestore()
  }
}

function makeFakeGithub(
  baseBlobSha = BLOB_SHA,
  providerKeepsDraft = true,
  mergeAndDeleteBeforeRecord = false,
  tamperH1BeforeRecord = false,
) {
  let branchName: string | null = null
  let branchTip: string | null = null
  let branchContent: string | null = null
  let markerMessage = ''
  let pullRequest: {
    number: number
    state: 'open' | 'closed'
    draft: boolean
    merged: boolean
    headRef: string
    baseRef: string
    body: string
    title: string
  } | null = null

  const calls = {
    getFileContent: vi.fn(),
    getBranchSha: vi.fn(),
    createBranchWithMarker: vi.fn(),
    commitFile: vi.fn(),
    createPullRequest: vi.fn(),
    getPullRequestDetail: vi.fn(),
    closePullRequest: vi.fn(),
    deleteBranch: vi.fn(),
  }
  const client: CtsGithubClient = {
    getFileContent: calls.getFileContent.mockImplementation(async (_owner, _repo, _path, branch) => {
      if (branch === DEFAULT_BRANCH) return { sha: baseBlobSha, decodedContent: SOURCE }
      if (branch === branchName && branchContent !== null) {
        return { sha: 'cts-head-blob-sha', decodedContent: branchContent }
      }
      throw Object.assign(new Error('not found'), { status: 404 })
    }),
    getBranchSha: calls.getBranchSha.mockImplementation(async (_owner, _repo, branch) => {
      if (branch === DEFAULT_BRANCH) return 'cts-base-commit-sha'
      if (branch === branchName && branchTip) return branchTip
      throw Object.assign(new Error('not found'), { status: 404 })
    }),
    createBranchWithMarker: calls.createBranchWithMarker.mockImplementation(
      async (_owner, _repo, branch, _fromSha, marker) => {
        branchName = branch
        branchTip = 'cts-marker-commit-sha'
        markerMessage = marker
        return branchTip
      },
    ),
    commitFileWithReceipt: calls.commitFile.mockImplementation(
      async (_owner, _repo, path, branch, content, message, blobSha) => {
        expect(path).toBe(CONTENT_PATH)
        expect(branch).toBe(branchName)
        expect(blobSha).toBe(BLOB_SHA)
        branchContent = content
        branchTip = 'cts-content-commit-sha'
        markerMessage = message
        return { commitSha: branchTip, contentSha: 'cts-head-blob-sha' }
      },
    ),
    createPullRequest: calls.createPullRequest.mockImplementation(async (_owner, _repo, input) => {
      pullRequest = {
        number: 17,
        state: 'open',
        draft: providerKeepsDraft && input.draft === true,
        merged: false,
        headRef: input.head,
        baseRef: input.base,
        body: input.body,
        title: input.title,
      }
      return { number: 17, html_url: 'https://github.example.invalid/pr/17', title: input.title }
    }),
    listPullRequestsByHead: async () => pullRequest
      ? [{ number: pullRequest.number, html_url: 'https://github.example.invalid/pr/17', title: pullRequest.title }]
      : [],
    getPullRequestDetail: calls.getPullRequestDetail.mockImplementation(async () => {
      if (!pullRequest) throw Object.assign(new Error('not found'), { status: 404 })
      if (mergeAndDeleteBeforeRecord && calls.getPullRequestDetail.mock.calls.length >= 2) {
        pullRequest.state = 'closed'
        pullRequest.draft = false
        pullRequest.merged = true
        branchName = null
        branchTip = null
        branchContent = null
      }
      if (tamperH1BeforeRecord && calls.getPullRequestDetail.mock.calls.length >= 2 && branchContent) {
        branchContent = branchContent.replace(
          `h1: '${AFTER_H1}'`,
          "h1: 'Unapproved collaborator headline'",
        )
      }
      return {
        ...pullRequest,
        mergedAt: pullRequest.merged ? '2026-08-20T18:00:00.000Z' : null,
        htmlUrl: 'https://github.example.invalid/pr/17',
      }
    }),
    getPullRequestFiles: async () => [{ filename: CONTENT_PATH, status: 'modified' }],
    getCommit: async (_owner, _repo, sha) => ({ sha, message: markerMessage }),
    closePullRequest: calls.closePullRequest.mockImplementation(async () => {
      if (pullRequest) pullRequest.state = 'closed'
    }),
    deleteBranch: calls.deleteBranch.mockImplementation(async () => {
      branchName = null
      branchTip = null
      branchContent = null
    }),
  }
  return { client, calls, state: () => ({ branchName, branchContent, pullRequest }) }
}

describe('LOCAL SYNTHETIC · CTS GSC evidence → Kernel approval → GitHub Draft PR', () => {
  it('is disabled by default and cannot insert a Kernel run without the rollout flag', async () => {
    const previous = process.env.CTS_GITHUB_METADATA_ACTION_ENABLED
    delete process.env.CTS_GITHUB_METADATA_ACTION_ENABLED
    const runAction = vi.fn()
    try {
      await expect(submitCtsGithubReferenceLoop(
        {
          caller: {
            kernelDeps: {} as never,
            mapCandidate: mapCandidateIdentity,
            runAction,
          },
        },
        {
          preparation: preparation(),
          kernelMeta: {
            clientId: CTS_CLIENT_ID,
            purpose: 'growth',
            goalId: GOAL_A,
            triggeredBy: 'human',
          },
        },
      )).resolves.toEqual({
        ok: false,
        reason: 'cts_trigger_not_ready',
        detail: 'rollout_disabled',
      })
      expect(runAction).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.CTS_GITHUB_METADATA_ACTION_ENABLED
      else process.env.CTS_GITHUB_METADATA_ACTION_ENABLED = previous
    }
  })

  it('rejects cloned receipts before preparation', async () => {
    const input = preparation()
    const withClonedReceipt = prepareCtsGithubReferenceLoop({
      clientId: CTS_CLIENT_ID,
      source,
      sourceReceipt: { ...receipt },
      finding: input.finding,
      prescription: input.prescription,
      findingRefs: input.findingRefs,
      intents: input.request.intents,
      headline: input.headline,
      verification: input.verification,
      redline: { available: true, phrases: [] },
      redlineSource: input.redlineSource,
    })
    expect(withClonedReceipt).toEqual({ ok: false, reason: 'receipt_untrusted' })

  })

  it('pins the exact evidence/action and makes zero GitHub calls before approval', async () => {
    const fake = makeFakeGithub()
    const resolveConnection = vi.fn(async () => ({
      status: 'connected' as const,
      repoOwner: REPO_OWNER,
      repoName: REPO_NAME,
      defaultBranch: DEFAULT_BRANCH,
      plainToken: 'not-a-real-token',
    }))
    const fixture = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({
        'page.apply_cts_github_metadata_request': createPageApplyCtsGithubCapability({
          resolveConnection,
          createClient: () => fake.client,
        }),
      }),
      options: {
        policy: {
          client_id: CTS_CLIENT_ID,
          action_key: 'page.apply_cts_github_metadata_request',
          mode: 'require_approval',
        },
        goals: [{ id: GOAL_A, client_id: CTS_CLIENT_ID, title: 'Clarify CTS URL ownership' }],
      },
    })

    const pending = await submitCtsGithubReferenceLoop(
      { caller: createDefaultDeps(fixture.kernel) },
      {
        preparation: preparation(),
        kernelMeta: {
          clientId: CTS_CLIENT_ID,
          purpose: 'growth',
          goalId: GOAL_A,
          triggeredBy: 'human',
          rationale: 'LOCAL SYNTHETIC CTS GitHub metadata proof',
        },
      },
    )

    expect(pending).toMatchObject({ ok: true, outcome: 'pending_approval' })
    expect(resolveConnection).not.toHaveBeenCalled()
    expect(fake.calls.getFileContent).not.toHaveBeenCalled()
    expect(fake.calls.createBranchWithMarker).not.toHaveBeenCalled()
    expect(fake.calls.commitFile).not.toHaveBeenCalled()
    expect(fake.calls.createPullRequest).not.toHaveBeenCalled()

    const run = fixture.tables.action_runs[0]
    const decision = fixture.tables.authorization_decisions[0]
    expect(run).toMatchObject({
      client_id: CTS_CLIENT_ID,
      action_key: 'page.apply_cts_github_metadata_request',
      action_version: 2,
      status: 'pending_approval',
      input: {
        page_url: PAGE_URL,
        page_version_token: BLOB_SHA,
        github_repo_owner: REPO_OWNER,
        github_repo_name: REPO_NAME,
        github_default_branch: DEFAULT_BRANCH,
        github_content_path: CONTENT_PATH,
        github_entry_slug: ENTRY_SLUG,
        authorization_context: {
          source_receipt: {
            provider: 'gsc',
            property: 'sc-domain:ctstours.co.nz',
            country: 'nzl',
            page: GSC_PAGE,
            query: 'china tours',
            clicks: 2,
            impressions: 195,
          },
          validation_passed: true,
        },
      },
    })
    expect((run.evidence as Record<string, unknown>).authorization_context).toEqual(
      (run.input as Record<string, unknown>).authorization_context,
    )
    expect((decision.policy_snapshot as { input_hash?: unknown }).input_hash).toBe(
      canonicalHashOfInput(run.input),
    )
    expect((await listPendingApprovals(fixture.supabase, CTS_CLIENT_ID)).items).toHaveLength(1)

    if (!pending.ok) throw new Error(pending.reason)
    const executed = await approveAndRun(
      fixture.kernel,
      pending.runId,
      'local-reviewer@example.invalid',
    )

    expect(executed.kind).toBe('succeeded')
    expect(fake.calls.createBranchWithMarker).toHaveBeenCalledTimes(1)
    expect(fake.calls.commitFile).toHaveBeenCalledTimes(1)
    expect(fake.calls.createPullRequest).toHaveBeenCalledTimes(1)
    expect(fake.state().pullRequest).toMatchObject({ state: 'open', draft: true })
    expect(inspectCtsIntentForSlug(fake.state().branchContent ?? '', ENTRY_SLUG)).toMatchObject({
      title: AFTER_TITLE,
      description: AFTER_DESCRIPTION,
      h1: AFTER_H1,
    })
    expect(inspectCtsIntentForSlug(SOURCE, ENTRY_SLUG)).toMatchObject({
      title: BEFORE_TITLE,
      description: BEFORE_DESCRIPTION,
      h1: BEFORE_H1,
    })
  })

  it('re-reads the approved blob after approval and performs no write when SHA is stale', async () => {
    const fake = makeFakeGithub('changed-after-approval-sha')
    const fixture = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({
        'page.apply_cts_github_metadata_request': createPageApplyCtsGithubCapability({
          resolveConnection: async () => ({
            status: 'connected',
            repoOwner: REPO_OWNER,
            repoName: REPO_NAME,
            defaultBranch: DEFAULT_BRANCH,
            plainToken: 'not-a-real-token',
          }),
          createClient: () => fake.client,
        }),
      }),
      options: {
        policy: {
          client_id: CTS_CLIENT_ID,
          action_key: 'page.apply_cts_github_metadata_request',
          mode: 'require_approval',
        },
        goals: [{ id: GOAL_A, client_id: CTS_CLIENT_ID, title: 'Clarify CTS URL ownership' }],
      },
    })
    const pending = await submitCtsGithubReferenceLoop(
      { caller: createDefaultDeps(fixture.kernel) },
      {
        preparation: preparation(),
        kernelMeta: {
          clientId: CTS_CLIENT_ID,
          purpose: 'growth',
          goalId: GOAL_A,
          triggeredBy: 'human',
        },
      },
    )
    if (!pending.ok) throw new Error(pending.reason)
    const outcome = await approveAndRun(fixture.kernel, pending.runId, 'local-reviewer@example.invalid')

    expect(outcome.kind).toBe('dead_letter')
    expect(fake.calls.getFileContent).toHaveBeenCalledTimes(1)
    expect(fake.calls.createBranchWithMarker).not.toHaveBeenCalled()
    expect(fake.calls.commitFile).not.toHaveBeenCalled()
    expect(fake.calls.createPullRequest).not.toHaveBeenCalled()
  })

  it('fails verification and compensates when H1 drifts after the approved commit', async () => {
    const fake = makeFakeGithub(BLOB_SHA, true, false, true)
    const fixture = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({
        'page.apply_cts_github_metadata_request': createPageApplyCtsGithubCapability({
          resolveConnection: async () => ({
            status: 'connected',
            repoOwner: REPO_OWNER,
            repoName: REPO_NAME,
            defaultBranch: DEFAULT_BRANCH,
            plainToken: 'not-a-real-token',
          }),
          createClient: () => fake.client,
        }),
      }),
      options: {
        policy: {
          client_id: CTS_CLIENT_ID,
          action_key: 'page.apply_cts_github_metadata_request',
          mode: 'require_approval',
        },
        goals: [{ id: GOAL_A, client_id: CTS_CLIENT_ID, title: 'Clarify CTS URL ownership' }],
      },
    })
    const pending = await submitCtsGithubReferenceLoop(
      { caller: createDefaultDeps(fixture.kernel) },
      {
        preparation: preparation(),
        kernelMeta: {
          clientId: CTS_CLIENT_ID,
          purpose: 'growth',
          goalId: GOAL_A,
          triggeredBy: 'human',
        },
      },
    )
    if (!pending.ok) throw new Error(pending.reason)
    const outcome = await approveAndRun(fixture.kernel, pending.runId, 'local-reviewer@example.invalid')

    expect(outcome.kind).toBe('dead_letter')
    expect(fake.calls.closePullRequest).toHaveBeenCalledTimes(1)
    expect(fake.calls.deleteBranch).toHaveBeenCalledTimes(1)
  })

  it('re-checks the rollout kill switch after approval before any capability provider call', async () => {
    const fake = makeFakeGithub()
    const resolveConnection = vi.fn(async () => ({
      status: 'connected' as const,
      repoOwner: REPO_OWNER,
      repoName: REPO_NAME,
      defaultBranch: DEFAULT_BRANCH,
      plainToken: 'not-a-real-token',
    }))
    const fixture = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({
        'page.apply_cts_github_metadata_request': createPageApplyCtsGithubCapability({
          resolveConnection,
          createClient: () => fake.client,
        }),
      }),
      options: {
        policy: {
          client_id: CTS_CLIENT_ID,
          action_key: 'page.apply_cts_github_metadata_request',
          mode: 'require_approval',
        },
        goals: [{ id: GOAL_A, client_id: CTS_CLIENT_ID, title: 'Clarify CTS URL ownership' }],
      },
    })
    const pending = await submitCtsGithubReferenceLoop(
      { caller: createDefaultDeps(fixture.kernel) },
      {
        preparation: preparation(),
        kernelMeta: {
          clientId: CTS_CLIENT_ID,
          purpose: 'growth',
          goalId: GOAL_A,
          triggeredBy: 'human',
        },
      },
    )
    if (!pending.ok) throw new Error(pending.reason)
    process.env.CTS_GITHUB_METADATA_ACTION_ENABLED = 'false'
    try {
      const outcome = await approveAndRun(
        fixture.kernel,
        pending.runId,
        'local-reviewer@example.invalid',
      )
      expect(outcome.kind).toBe('dead_letter')
      expect(resolveConnection).not.toHaveBeenCalled()
      expect(fake.calls.getFileContent).not.toHaveBeenCalled()
      expect(fake.calls.createBranchWithMarker).not.toHaveBeenCalled()
      expect(fake.calls.commitFile).not.toHaveBeenCalled()
      expect(fake.calls.createPullRequest).not.toHaveBeenCalled()
    } finally {
      process.env.CTS_GITHUB_METADATA_ACTION_ENABLED = 'true'
    }
  })

  it('fails closed without closing or deleting when GitHub does not return an owned Draft PR', async () => {
    const fake = makeFakeGithub(BLOB_SHA, false)
    const fixture = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({
        'page.apply_cts_github_metadata_request': createPageApplyCtsGithubCapability({
          resolveConnection: async () => ({
            status: 'connected',
            repoOwner: REPO_OWNER,
            repoName: REPO_NAME,
            defaultBranch: DEFAULT_BRANCH,
            plainToken: 'not-a-real-token',
          }),
          createClient: () => fake.client,
        }),
      }),
      options: {
        policy: {
          client_id: CTS_CLIENT_ID,
          action_key: 'page.apply_cts_github_metadata_request',
          mode: 'require_approval',
        },
        goals: [{ id: GOAL_A, client_id: CTS_CLIENT_ID, title: 'Clarify CTS URL ownership' }],
      },
    })
    const pending = await submitCtsGithubReferenceLoop(
      { caller: createDefaultDeps(fixture.kernel) },
      {
        preparation: preparation(),
        kernelMeta: {
          clientId: CTS_CLIENT_ID,
          purpose: 'growth',
          goalId: GOAL_A,
          triggeredBy: 'human',
        },
      },
    )
    if (!pending.ok) throw new Error(pending.reason)
    const outcome = await approveAndRun(fixture.kernel, pending.runId, 'local-reviewer@example.invalid')

    expect(outcome.kind).toBe('dead_letter')
    expect(fake.state().pullRequest).toMatchObject({ draft: false, state: 'open' })
    expect(fake.calls.closePullRequest).not.toHaveBeenCalled()
    expect(fake.calls.deleteBranch).not.toHaveBeenCalled()
  })

  it('does not report rollback success when a merged PR auto-deletes its branch', async () => {
    const fake = makeFakeGithub(BLOB_SHA, true, true)
    const fixture = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: () => ({
        'page.apply_cts_github_metadata_request': createPageApplyCtsGithubCapability({
          resolveConnection: async () => ({
            status: 'connected',
            repoOwner: REPO_OWNER,
            repoName: REPO_NAME,
            defaultBranch: DEFAULT_BRANCH,
            plainToken: 'not-a-real-token',
          }),
          createClient: () => fake.client,
        }),
      }),
      options: {
        policy: {
          client_id: CTS_CLIENT_ID,
          action_key: 'page.apply_cts_github_metadata_request',
          mode: 'require_approval',
        },
        goals: [{ id: GOAL_A, client_id: CTS_CLIENT_ID, title: 'Clarify CTS URL ownership' }],
      },
    })
    const pending = await submitCtsGithubReferenceLoop(
      { caller: createDefaultDeps(fixture.kernel) },
      {
        preparation: preparation(),
        kernelMeta: {
          clientId: CTS_CLIENT_ID,
          purpose: 'growth',
          goalId: GOAL_A,
          triggeredBy: 'human',
        },
      },
    )
    if (!pending.ok) throw new Error(pending.reason)
    const outcome = await approveAndRun(fixture.kernel, pending.runId, 'local-reviewer@example.invalid')

    expect(outcome.kind).toBe('dead_letter')
    expect(fake.state().pullRequest).toMatchObject({ merged: true, state: 'closed' })
    expect(fake.calls.closePullRequest).not.toHaveBeenCalled()
    expect(fake.calls.deleteBranch).not.toHaveBeenCalled()
    const run = fixture.tables.action_runs[0]
    expect(run.rollback_status).not.toBe('succeeded')
  })
})
