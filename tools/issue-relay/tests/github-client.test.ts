import { describe, expect, it, vi } from 'vitest'
import { GitHubClient } from '../src/github-client'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response
}

function rawComment(id: number) {
  return {
    id,
    body: `comment ${id}`,
    user: { login: 'someone', type: 'User' },
    author_association: 'NONE',
  }
}

describe('GitHubClient', () => {
  it('throws immediately when constructed without a token', () => {
    expect(() => new GitHubClient({ token: '', owner: 'o', repo: 'r' })).toThrow(/missing token/)
  })

  it('maps a single short page of comments without pagination', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([rawComment(1), rawComment(2)]))
    const client = new GitHubClient({ token: 't', owner: 'o', repo: 'r', fetchImpl })

    const comments = await client.listIssueComments(910)

    expect(comments).toEqual([
      { id: 1, body: 'comment 1', login: 'someone', userType: 'User', authorAssociation: 'NONE' },
      { id: 2, body: 'comment 2', login: 'someone', userType: 'User', authorAssociation: 'NONE' },
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('walks multiple pages until a short page is returned', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => rawComment(i + 1))
    const shortPage = [rawComment(101)]
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockResolvedValueOnce(jsonResponse(shortPage))

    const client = new GitHubClient({ token: 't', owner: 'o', repo: 'r', fetchImpl })
    const comments = await client.listIssueComments(910)

    expect(comments).toHaveLength(101)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws rather than silently truncating when the walk never finds a short page', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => rawComment(i + 1))
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(fullPage))
    const client = new GitHubClient({ token: 't', owner: 'o', repo: 'r', fetchImpl })

    await expect(client.listIssueComments(910)).rejects.toThrow(/exceeded/)
  })

  it('throws on a non-ok response instead of returning a partial result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'nope' }, false))
    const client = new GitHubClient({ token: 't', owner: 'o', repo: 'r', fetchImpl })

    await expect(client.listIssueComments(910)).rejects.toThrow(/failed: 500/)
  })

  it('posts a comment with the given body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rawComment(1)))
    const client = new GitHubClient({ token: 't', owner: 'o', repo: 'r', fetchImpl })

    await client.createIssueComment(910, 'hello')

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/r/issues/910/comments',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'hello' }) })
    )
  })
})
