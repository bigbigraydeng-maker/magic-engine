import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listIssueComments, listPullRequestFiles, listReviewComments } from '../src/github.mjs'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('listPullRequestFiles', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * `listPullRequestFiles` now cross-checks the paginated file list against
   * the PR resource's own `changed_files` count (Codex finding, PR #1211,
   * P2 — see the production code's header comment for why), so every test
   * below must stub that first GET before the `.../files` page(s).
   */
  function stubChangedFiles(count: number) {
    fetchMock.mockResolvedValueOnce(jsonResponse({ changed_files: count }))
  }

  it('returns a single page as-is when it is short of 100 entries', async () => {
    const batch = [{ filename: 'a.ts' }, { filename: 'b.ts' }]
    stubChangedFiles(2)
    fetchMock.mockResolvedValueOnce(jsonResponse(batch))

    const files = await listPullRequestFiles('tok', 'o', 'r', 1)

    expect(files).toEqual(batch)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('page=1')
  })

  it('follows pagination across multiple full pages and stops at the short one', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `p1-${i}.ts` }))
    const page2 = Array.from({ length: 100 }, (_, i) => ({ filename: `p2-${i}.ts` }))
    const page3 = [{ filename: 'last.ts' }]
    stubChangedFiles(201)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2))
      .mockResolvedValueOnce(jsonResponse(page3))

    const files = await listPullRequestFiles('tok', 'o', 'r', 1)

    expect(files).toHaveLength(201)
    expect(files[0]).toEqual({ filename: 'p1-0.ts' })
    expect(files[200]).toEqual({ filename: 'last.ts' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('preserves rename metadata untouched', async () => {
    const batch = [{ filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed' }]
    stubChangedFiles(1)
    fetchMock.mockResolvedValueOnce(jsonResponse(batch))

    const files = await listPullRequestFiles('tok', 'o', 'r', 1)

    expect(files[0]).toMatchObject({ filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed' })
  })

  it('throws rather than returning a partial list when a page request fails', async () => {
    stubChangedFiles(1)
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, false, 500))

    await expect(listPullRequestFiles('tok', 'o', 'r', 1)).rejects.toThrow(/failed: 500/)
  })

  it('fails closed if pagination never terminates within the page cap', async () => {
    // Every page comes back full (100 entries), so the loop never sees the
    // "short page" signal that normally ends it. Getting a list back here
    // would be a silently truncated one dressed up as complete.
    stubChangedFiles(999999)
    fetchMock.mockImplementation(async () => jsonResponse(Array.from({ length: 100 }, () => ({ filename: 'x.ts' }))))

    await expect(listPullRequestFiles('tok', 'o', 'r', 1)).rejects.toThrow(/did not terminate/)
  }, 20000)

  it('fails closed when the files API returns fewer files than the PR reports changed — GitHub caps this endpoint at 3000', async () => {
    // Codex finding (PR #1211, P2): past GitHub's 3000-file cap on this
    // endpoint, a truncated list ends on a page short of 100 (or empty) for
    // the same reason a genuinely complete list does — `paginateAll`'s own
    // "short page = done" rule cannot tell the two apart. `changed_files` is
    // a plain count on the PR resource, not subject to that cap, so a
    // mismatch is the only reliable signal the list was cut short. Modelled
    // here with a small short page against a much larger declared count —
    // the same shape a truncated 3000-file response has, without needing 30
    // fixture pages to reach the real boundary.
    const page1 = [{ filename: 'a.ts' }, { filename: 'b.ts' }]
    stubChangedFiles(3005)
    fetchMock.mockResolvedValueOnce(jsonResponse(page1))

    await expect(listPullRequestFiles('tok', 'o', 'r', 1)).rejects.toThrow(/reports 3005 changed files/)
  })

  it('does not throw when the changed_files count matches the fully-read list exactly', async () => {
    const batch = [{ filename: 'a.ts' }, { filename: 'b.ts' }, { filename: 'c.ts' }]
    stubChangedFiles(3)
    fetchMock.mockResolvedValueOnce(jsonResponse(batch))

    await expect(listPullRequestFiles('tok', 'o', 'r', 1)).resolves.toEqual(batch)
  })
})

describe('listIssueComments', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a single page as-is when it is short of 100 entries', async () => {
    const batch = [{ id: 1, body: 'a' }, { id: 2, body: 'b' }]
    fetchMock.mockResolvedValueOnce(jsonResponse(batch))

    const comments = await listIssueComments('tok', 'o', 'r', 7)

    expect(comments).toEqual(batch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows pagination across multiple full pages, preserving oldest-first order', async () => {
    // GitHub returns issue comments oldest-first — the order every
    // "last trusted marker wins" caller (gate-marker.mjs's findGateFor) relies
    // on. A PR long enough to spill past page 1 must not lose the newest,
    // most-authoritative markers off the far end.
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i, body: `c${i}` }))
    const page2 = [{ id: 100, body: 'newest — carries the real decision marker' }]
    fetchMock.mockResolvedValueOnce(jsonResponse(page1)).mockResolvedValueOnce(jsonResponse(page2))

    const comments = await listIssueComments('tok', 'o', 'r', 7)

    expect(comments).toHaveLength(101)
    expect(comments[0]).toEqual({ id: 0, body: 'c0' })
    expect(comments[100]).toEqual(page2[0])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws rather than returning a partial list when a page request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, false, 500))

    await expect(listIssueComments('tok', 'o', 'r', 7)).rejects.toThrow(/failed: 500/)
  })

  it('fails closed if pagination never terminates within the page cap', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(Array.from({ length: 100 }, () => ({ id: 1, body: 'x' }))))

    await expect(listIssueComments('tok', 'o', 'r', 7)).rejects.toThrow(/did not terminate/)
  }, 20000)
})

describe('listReviewComments', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('follows pagination across multiple full pages', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i, path: 'a.ts', body: `c${i}` }))
    const page2 = [{ id: 100, path: 'a.ts', body: 'last' }]
    fetchMock.mockResolvedValueOnce(jsonResponse(page1)).mockResolvedValueOnce(jsonResponse(page2))

    const comments = await listReviewComments('tok', 'o', 'r', 7, 99)

    expect(comments).toHaveLength(101)
    expect(comments[100]).toEqual(page2[0])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws rather than returning a partial list when a page request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, false, 500))

    await expect(listReviewComments('tok', 'o', 'r', 7, 99)).rejects.toThrow(/failed: 500/)
  })
})
