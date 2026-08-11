/**
 * The PR file list has to be complete or absent — never partial.
 *
 * The defect: `listPullRequestFiles` asked for `per_page=100` and stopped. A PR
 * with 120 changed files therefore reported 100, and the inspector handed that
 * truncated list to `evaluateImplementerTurn` as the authoritative record. A
 * protected or out-of-scope file sitting at position 101 sailed past the path
 * policy, because nothing in the system knew it existed.
 *
 * Truncation is worse than failure here: the policy layer cannot tell a short
 * list from a complete one, so a partial answer is a confidently wrong answer.
 * Every failure mode below is therefore an exception, not a smaller array.
 */

import { describe, expect, it, vi } from 'vitest'

import { MAX_PR_FILE_PAGES, PR_FILES_PER_PAGE, RestGitHubClient } from '../src/adapters/github/rest-client'
import { GitHubPullRequestInspector } from '../src/adapters/workspace/github-pr-inspector'
import { enforceProtectedPaths } from '../src/policy/policy'

const REPO = { owner: 'bigbigraydeng-maker', repo: 'magic-engine' }

type Page = unknown[] | 'error'

function file(name: string, sha = `blob-${name}`) {
  return { filename: name, sha }
}

/** Serves `pages` in order; any page not listed throws, as a real outage would. */
function pagedFetch(pages: Record<number, unknown[] | 'error'>, changedFiles?: number) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url.toString()
    if (href.includes('/pulls/861/files')) {
      const page = Number(new URL(href).searchParams.get('page') ?? '1')
      const body = pages[page]
      if (body === undefined || body === 'error') {
        return new Response('upstream failure', { status: 502 })
      }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    // `GET /pulls/861` — carries GitHub's own changed_files count, which the walk
    // checks itself against. Defaults to however many the fake actually serves.
    // Distinct filenames, matching what GitHub reports: a duplicate across pages
    // is an artefact of the walk, not an extra changed file.
    const distinct = new Set(
      Object.values(pages)
        .flatMap((page) => (page === 'error' ? [] : page))
        .map((entry) => (entry as { filename: string }).filename)
    )
    const served = distinct.size
    return new Response(
      JSON.stringify({
        number: 861,
        merged: false,
        head: { sha: 'abc', ref: 'claude/x' },
        changed_files: changedFiles ?? served,
      }),
      { status: 200 }
    )
  })
}

function clientWith(pages: Record<number, unknown[] | 'error'>, changedFiles?: number) {
  const fetchImpl = pagedFetch(pages, changedFiles)
  const client = new RestGitHubClient({
    token: 'ghp_test',
    repository: REPO,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { client, fetchImpl }
}

const fullPage = Array.from({ length: PR_FILES_PER_PAGE }, (_unused, index) =>
  file(`docs/specs/file-${String(index).padStart(3, '0')}.md`)
)

describe('more than one page', () => {
  it('reads past 100 files instead of stopping at the first page', async () => {
    const { client, fetchImpl } = clientWith({ 1: fullPage, 2: [file('docs/specs/file-100.md')] })

    const listing = await client.listPullRequestFiles(861)

    expect(listing.file_count).toBe(101)
    expect(listing.pages_read).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // PR pre-fetch + two pages
  })

  it('finds a protected file sitting at position 101', async () => {
    // The exact scenario from the review: the breach is on page two.
    const { client } = clientWith({
      1: fullPage,
      2: [file('tools/ai-orchestrator/src/policy/policy.ts')],
    })

    const listing = await client.listPullRequestFiles(861)
    const decision = enforceProtectedPaths(listing.files.map((entry) => entry.filename))

    expect(decision).toMatchObject({ allowed: false, code: 'PROTECTED_PATH_TOUCHED' })
    expect(decision.allowed === false && decision.offending).toEqual([
      'tools/ai-orchestrator/src/policy/policy.ts',
    ])
  })

  it('would have missed it on the first page alone — the control', () => {
    // Proves the previous test is testing pagination and not something else.
    expect(enforceProtectedPaths(fullPage.map((entry) => entry.filename)).allowed).toBe(true)
  })

  it('carries the same file through to the inspector fingerprints', async () => {
    const { client } = clientWith({
      1: fullPage,
      2: [file('tools/ai-orchestrator/src/runner.ts', 'blob-breach')],
    })

    const state = await new GitHubPullRequestInspector(client, 861).capture()

    expect(state.file_fingerprints['tools/ai-orchestrator/src/runner.ts']).toBe('blob-breach')
    expect(Object.keys(state.file_fingerprints)).toHaveLength(101)
  })

  it('records how many pages and files it read, as auditable evidence', async () => {
    const { client } = clientWith({ 1: fullPage, 2: fullPage.map((f) => file(`b/${f.filename}`)), 3: [] })

    const state = await new GitHubPullRequestInspector(client, 861).capture()

    expect(state.source).toBe('github:pr-files(pages=3,files=200)')
  })
})

describe('a failed page is a failure, never a shorter list', () => {
  it('throws when page two cannot be read', async () => {
    const { client } = clientWith({ 1: fullPage, 2: 'error' })
    await expect(client.listPullRequestFiles(861)).rejects.toThrow(/502/)
  })

  it('stops the inspector rather than capturing a partial view', async () => {
    const { client } = clientWith({ 1: fullPage, 2: 'error' })
    await expect(new GitHubPullRequestInspector(client, 861).capture()).rejects.toThrow()
  })

  it('refuses a pull request larger than the page budget', async () => {
    const pages: Record<number, unknown[]> = {}
    for (let page = 1; page <= MAX_PR_FILE_PAGES + 1; page += 1) {
      pages[page] = fullPage.map((entry) => file(`p${page}/${entry.filename}`))
    }
    const { client } = clientWith(pages)

    await expect(client.listPullRequestFiles(861)).rejects.toThrow(/refusing to treat a/)
  })

  it('succeeds on a single short page — the positive control', async () => {
    const { client, fetchImpl } = clientWith({ 1: [file('docs/specs/a.md')] })
    const listing = await client.listPullRequestFiles(861)
    expect(listing).toMatchObject({ file_count: 1, pages_read: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(2) // PR pre-fetch + one page
  })
})

describe('a list that shifts under the walk is caught, not silently truncated', () => {
  it('throws when fewer files come back than GitHub says exist', async () => {
    // The deletion case: removing an entry between two page requests shifts every
    // later file onto a lower offset, so the walk skips one and the shortfall
    // looks exactly like a genuine end of list. Only the authoritative count
    // tells the two apart — ordering cannot, and dedupe sees no duplicate.
    const { client } = clientWith({ 1: fullPage, 2: [file('b/1.md'), file('b/2.md')] }, 103)

    await expect(client.listPullRequestFiles(861)).rejects.toThrow(
      /read 102 entries but the API reported at least 103/
    )
  })

  it('accepts a list that grew during the walk', async () => {
    // Appends are harmless: they land past the end, so nothing is skipped.
    const { client } = clientWith({ 1: fullPage, 2: [file('b/1.md')] }, 100)
    await expect(client.listPullRequestFiles(861)).resolves.toMatchObject({ file_count: 101 })
  })

  it('accepts an exact match — the positive control', async () => {
    const { client } = clientWith({ 1: [file('a.md')] }, 1)
    await expect(client.listPullRequestFiles(861)).resolves.toMatchObject({ file_count: 1 })
  })

  it('throws on a list that is an exact multiple of the page size', async () => {
    // The final full page leaves the loop with no short page to end on, so the
    // walk runs out of budget. Failing is correct; returning those N items as if
    // they were everything is what must not happen.
    const pages: Record<number, Page> = {}
    for (let page = 1; page <= MAX_PR_FILE_PAGES; page += 1) {
      pages[page] = fullPage.map((entry) => file(`p${page}/${entry.filename}`))
    }
    const { client } = clientWith(pages)

    await expect(client.listPullRequestFiles(861)).rejects.toThrow(/exceeded 30 pages/)
  })
})

describe('duplicates cannot hide or overwrite a real entry', () => {
  it('keeps the first occurrence and a stable order', async () => {
    const { client } = clientWith({
      1: [file('a.md', 'blob-a'), file('b.md', 'blob-b')],
    })

    const listing = await client.listPullRequestFiles(861)
    expect(listing.files.map((entry) => entry.filename)).toEqual(['a.md', 'b.md'])
  })

  it('does not let a repeat on page two mask the breach on page one', async () => {
    // A duplicate that overwrote the earlier entry could swap a real blob sha for
    // a harmless one, which would move a file out of the turn delta entirely.
    const breach = 'tools/ai-orchestrator/src/runner.ts'
    const { client } = clientWith({
      1: [...fullPage.slice(0, 99), file(breach, 'blob-real')],
      2: [file(breach, 'blob-decoy')],
    })

    const listing = await client.listPullRequestFiles(861)
    const entries = listing.files.filter((entry) => entry.filename === breach)

    expect(entries).toHaveLength(1)
    expect(entries[0].sha).toBe('blob-real')
    expect(enforceProtectedPaths(listing.files.map((entry) => entry.filename)).allowed).toBe(false)
  })
})
