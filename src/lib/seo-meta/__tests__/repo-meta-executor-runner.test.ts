/**
 * Tests for the runRepoMetaExecutor side-effecting runner (客户数据红线 #1121):
 *   1. Missing / disabled / incomplete seo_config.repo_meta_executor → a
 *      visible `not_configured` result BEFORE any AI or GitHub call
 *      (fail-closed — never a guessed default).
 *   2. A fake, non-CTS client runs the exact same seam end to end — the
 *      client's own dataDir/brandSuffix/voiceHint drive the AI prompt and
 *      the audit log, not any hardcoded customer fact.
 *
 * The pure narrow-lane editor / slug index / candidate picker are covered
 * separately in repo-meta-executor.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cms/connection-store', () => ({
  getConnection: vi.fn(),
}))

vi.mock('@/lib/cms/github-client', () => {
  const mockClient = {
    listDirectory: vi.fn(),
    getFileContent: vi.fn(),
    getBranchSha: vi.fn(),
    createBranch: vi.fn(),
    commitFile: vi.fn(),
    createPullRequest: vi.fn(),
  }
  return {
    GithubClient: vi.fn(() => mockClient),
    __mockClient: mockClient,
  }
})

vi.mock('@anthropic-ai/sdk', () => {
  const create = vi.fn()
  return {
    default: vi.fn().mockImplementation(() => ({ messages: { create } })),
    __mockCreate: create,
  }
})

import { runRepoMetaExecutor } from '../repo-meta-executor'
import { getConnection } from '@/lib/cms/connection-store'
import * as githubClientModule from '@/lib/cms/github-client'
import * as anthropicModule from '@anthropic-ai/sdk'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGh = (githubClientModule as any).__mockClient as {
  listDirectory: ReturnType<typeof vi.fn>
  getFileContent: ReturnType<typeof vi.fn>
  getBranchSha: ReturnType<typeof vi.fn>
  createBranch: ReturnType<typeof vi.fn>
  commitFile: ReturnType<typeof vi.fn>
  createPullRequest: ReturnType<typeof vi.fn>
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAiCreate = (anthropicModule as any).__mockCreate as ReturnType<typeof vi.fn>

const FAKE_CLIENT_ID = 'e1111111-1111-1111-1111-111111111111'

function makeSupabase(opts: {
  seoConfig: unknown
  recentLogs?: Array<{ page_slug: string }>
  gscSnapshot?: { top_pages?: unknown[]; top_queries?: unknown[] } | null
}) {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn((table: string) => {
    if (table === 'clients') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { seo_config: opts.seoConfig }, error: null }),
          }),
        }),
      }
    }
    if (table === 'seo_meta_log') {
      return {
        select: () => ({
          eq: () => ({ gte: () => Promise.resolve({ data: opts.recentLogs ?? [] }) }),
        }),
        insert,
      }
    }
    if (table === 'gsc_performance_snapshots') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: () => Promise.resolve({ data: opts.gscSnapshot ?? null }) }),
            }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from, insertMock: insert }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runRepoMetaExecutor · fail-closed config gate', () => {
  it('no seo_config at all → not_configured, no AI/GitHub call', async () => {
    const { from } = makeSupabase({ seoConfig: null })
    const result = await runRepoMetaExecutor({ from } as never, FAKE_CLIENT_ID)

    expect(result).toEqual({ outcome: 'not_configured' })
    expect(getConnection).not.toHaveBeenCalled()
    expect(mockGh.listDirectory).not.toHaveBeenCalled()
    expect(mockAiCreate).not.toHaveBeenCalled()
  })

  it('repo_meta_executor.enabled === false → not_configured, no side effects', async () => {
    const { from } = makeSupabase({
      seoConfig: {
        repo_meta_executor: { enabled: false, dataDir: 'src/lib/data', brandSuffix: '', voiceHint: 'x' },
      },
    })
    const result = await runRepoMetaExecutor({ from } as never, FAKE_CLIENT_ID)

    expect(result).toEqual({ outcome: 'not_configured' })
    expect(getConnection).not.toHaveBeenCalled()
  })

  it('enabled but missing dataDir → not_configured (never guesses a default dir)', async () => {
    const { from } = makeSupabase({
      seoConfig: { repo_meta_executor: { enabled: true, dataDir: '', brandSuffix: '', voiceHint: 'x' } },
    })
    const result = await runRepoMetaExecutor({ from } as never, FAKE_CLIENT_ID)

    expect(result).toEqual({ outcome: 'not_configured' })
    expect(getConnection).not.toHaveBeenCalled()
  })

  it('enabled but missing voiceHint → not_configured', async () => {
    const { from } = makeSupabase({
      seoConfig: {
        repo_meta_executor: { enabled: true, dataDir: 'src/lib/data', brandSuffix: '', voiceHint: '' },
      },
    })
    const result = await runRepoMetaExecutor({ from } as never, FAKE_CLIENT_ID)

    expect(result).toEqual({ outcome: 'not_configured' })
  })

  it('enabled but unsafe dataDir (path traversal) → not_configured, no GitHub/AI call', async () => {
    const { from } = makeSupabase({
      seoConfig: {
        repo_meta_executor: {
          enabled: true,
          dataDir: '../../etc',
          brandSuffix: '',
          voiceHint: 'x',
        },
      },
    })
    const result = await runRepoMetaExecutor({ from } as never, FAKE_CLIENT_ID)

    expect(result).toEqual({ outcome: 'not_configured' })
    expect(getConnection).not.toHaveBeenCalled()
    expect(mockGh.listDirectory).not.toHaveBeenCalled()
    expect(mockAiCreate).not.toHaveBeenCalled()
  })

  it('clients read error → error outcome, no AI/GitHub call', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
    const result = await runRepoMetaExecutor({ from } as never, FAKE_CLIENT_ID)

    expect(result).toEqual({ outcome: 'error', error: 'boom' })
    expect(getConnection).not.toHaveBeenCalled()
  })
})

describe('runRepoMetaExecutor · a non-CTS fake client runs the same seam end to end', () => {
  const CONFIG = {
    enabled: true,
    dataDir: 'src/lib/data',
    brandSuffix: '| Example Travel',
    voiceHint: 'You write for a boutique adventure-travel brand based in Queenstown, NZ.',
  }

  it('generates a PR using THIS client\'s config, and logs THIS client\'s id — not a hardcoded customer fact', async () => {
    const { from, insertMock } = makeSupabase({
      seoConfig: { repo_meta_executor: CONFIG },
      gscSnapshot: {
        top_pages: [{ page: 'https://example-travel.test/fiordland-tours', impressions: 500, position: 6 }],
        top_queries: [{ query: 'fiordland tours nz', impressions: 300 }],
      },
    })

    vi.mocked(getConnection).mockResolvedValue({
      repoOwner: 'example-org',
      repoName: 'example-travel-site',
      branch: 'main',
      plainToken: 'ghp_fake',
    } as never)

    mockGh.listDirectory.mockResolvedValue([
      { name: 'seo-pages.ts', path: 'src/lib/data/seo-pages.ts', type: 'file' },
    ])
    mockGh.getFileContent.mockResolvedValue({
      decodedContent:
        "export const fiordlandMeta = {\n  slug: 'fiordland-tours',\n  title: 'Old Title',\n  description: 'Old desc.',\n};\n",
      sha: 'blob-sha-1',
    })
    mockGh.getBranchSha.mockResolvedValue('base-sha-1')
    mockGh.createBranch.mockResolvedValue(undefined)
    mockGh.commitFile.mockResolvedValue(undefined)
    mockGh.createPullRequest.mockResolvedValue({
      html_url: 'https://github.com/example-org/example-travel-site/pull/1',
    })
    mockAiCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Fiordland Tours | Example Travel',
            desc: 'Explore Fiordland with a local guide.',
          }),
        },
      ],
    })

    const result = await runRepoMetaExecutor({ from } as never, FAKE_CLIENT_ID)

    expect(result.outcome).toBe('pr_opened')
    expect(result.pr_url).toBe('https://github.com/example-org/example-travel-site/pull/1')
    expect(getConnection).toHaveBeenCalledWith(FAKE_CLIENT_ID)
    expect(mockGh.listDirectory).toHaveBeenCalledWith(
      'example-org', 'example-travel-site', 'src/lib/data', 'main',
    )
    expect(mockGh.createPullRequest).toHaveBeenCalledTimes(1)

    // Audit log carries the FAKE client's id — never a hardcoded CTS UUID.
    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({ client_id: FAKE_CLIENT_ID, page_slug: 'fiordland-tours' }),
    ])

    // The AI prompt is built from THIS client's own config, not a shared
    // customer fact baked into the module (客户数据红线 #2).
    const promptArg = mockAiCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }
    const promptText = promptArg.messages[0].content
    expect(promptText).toContain('Queenstown')
    expect(promptText).toContain('| Example Travel')
    expect(promptText).not.toMatch(/CTS|China travel/i)
  })

  it('no GSC candidates → no_candidates, before any GitHub/AI call', async () => {
    const { from } = makeSupabase({
      seoConfig: { repo_meta_executor: CONFIG },
      gscSnapshot: { top_pages: [], top_queries: [] },
    })

    const result = await runRepoMetaExecutor({ from } as never, FAKE_CLIENT_ID)

    expect(result).toEqual({ outcome: 'no_candidates' })
    expect(getConnection).not.toHaveBeenCalled()
    expect(mockAiCreate).not.toHaveBeenCalled()
  })

  it('no repo connection → no_connection', async () => {
    const { from } = makeSupabase({
      seoConfig: { repo_meta_executor: CONFIG },
      gscSnapshot: {
        top_pages: [{ page: 'https://example-travel.test/fiordland-tours', impressions: 500, position: 6 }],
        top_queries: [{ query: 'fiordland tours nz', impressions: 300 }],
      },
    })
    vi.mocked(getConnection).mockResolvedValue(null as never)

    const result = await runRepoMetaExecutor({ from } as never, FAKE_CLIENT_ID)

    expect(result).toEqual({ outcome: 'no_connection' })
    expect(mockAiCreate).not.toHaveBeenCalled()
  })
})
