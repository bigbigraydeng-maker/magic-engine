import { afterEach, describe, expect, it, vi } from 'vitest'
import { GithubClient } from '@/lib/cms/github-client'

afterEach(() => vi.restoreAllMocks())

describe('GithubClient governed CTS provider receipts', () => {
  it('returns immutable commit/content SHAs from exactly one file PUT', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      commit: { sha: 'commit-sha-1' },
      content: { sha: 'content-sha-1' },
    }), { status: 200 }))
    const client = new GithubClient('not-a-real-token')

    await expect(client.commitFileWithReceipt(
      'owner',
      'repo',
      'src/lib/data/seo-pages.ts',
      'me/cts-meta/branch',
      'export const value = 1\n',
      '[kernel run run-1] seo: update china-tours metadata',
      'before-blob-sha',
    )).resolves.toEqual({ commitSha: 'commit-sha-1', contentSha: 'content-sha-1' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
  })

  it('fails closed when GitHub reports success without both immutable SHAs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      commit: { sha: 'commit-sha-1' },
      content: {},
    }), { status: 200 }))
    const client = new GithubClient('not-a-real-token')
    await expect(client.commitFileWithReceipt(
      'owner', 'repo', 'path.ts', 'branch', 'content', 'message', 'before-sha',
    )).rejects.toThrow('missing commit/content SHA')
  })

  it('returns the exact PR changed-file list and rejects malformed rows', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { filename: 'src/lib/data/seo-pages.ts', status: 'modified' },
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { filename: '', status: 'modified' },
      ]), { status: 200 }))
    const client = new GithubClient('not-a-real-token')
    await expect(client.getPullRequestFiles('owner', 'repo', 17)).resolves.toEqual([
      { filename: 'src/lib/data/seo-pages.ts', status: 'modified' },
    ])
    await expect(client.getPullRequestFiles('owner', 'repo', 17)).rejects.toThrow(
      'pull request files response invalid',
    )
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
