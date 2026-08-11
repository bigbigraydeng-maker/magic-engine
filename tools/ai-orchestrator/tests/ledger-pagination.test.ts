/**
 * The ledger and the kill switch must be read in full, or not at all.
 *
 * These two endpoints matter more than the PR file list, because they are not
 * evidence *about* the run — they are the run.
 *
 * - **Comments are the event ledger.** Reading only the first hundred rebuilds
 *   the run from a history that stops partway: a state it already left, an
 *   authorization it already consumed, a lease it already released, a budget it
 *   already spent. Nothing downstream can tell a truncated fold from a genuine
 *   one, because both produce a perfectly well-formed run.
 * - **Labels carry the kill switch.** A truncated label read fails in the single
 *   worst direction available: `me2-orchestrator:stop` is simply not there, and
 *   the run keeps spending.
 *
 * Every failure below is an exception, never a shorter array.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  ITEMS_PER_PAGE,
  MAX_ISSUE_COMMENT_PAGES,
  MAX_ISSUE_LABEL_PAGES,
  RestGitHubClient,
} from '../src/adapters/github/rest-client'
import { IssueCommentLedger, renderEventComment } from '../src/adapters/github/ledger'
import { ALLOWED_AUTHORIZERS, TRUSTED_LEDGER_AUTHORS } from '../src/config/scaffold-config'
import { evaluateKillSwitch, KILL_SWITCH_LABEL } from '../src/policy/policy'
import type { LedgerEvent } from '../src/domain/schema'
import { FIXED_NOW } from './helpers'

const REPO = { owner: 'bigbigraydeng-maker', repo: 'magic-engine' }
const TRUST = {
  machineAuthors: [...TRUSTED_LEDGER_AUTHORS],
  humanAuthorizers: [...ALLOWED_AUTHORIZERS],
}

type Page = unknown[] | 'error'

interface Routes {
  comments?: Record<number, Page>
  labels?: Record<number, Page>
  /** What `GET /issues/{n}` reports. Defaults to the served page contents. */
  issue?: { comments?: number; labels?: { name: string }[] } | 'error'
}

/**
 * Distinct ids, matching what GitHub's `comments` count reports: a duplicate
 * across pages is an artefact of the walk, not an extra comment.
 */
function countServed(table: Record<number, Page> | undefined): number {
  if (!table) return 0
  const ids = new Set(
    Object.values(table)
      .flatMap((page) => (page === 'error' ? [] : page))
      .map((entry) => (entry as { id: number }).id)
  )
  return ids.size
}

/** Serves `pages` per endpoint; a missing or `'error'` page answers 502. */
function pagedFetch(routes: Routes) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url.toString()
    const parsed = new URL(href)
    const page = Number(parsed.searchParams.get('page') ?? '1')

    // The completeness pre-fetch: GitHub's own counts for this issue.
    if (/\/issues\/\d+$/.test(parsed.pathname)) {
      if (routes.issue === 'error') return new Response('upstream failure', { status: 502 })
      const distinctLabels = Array.from(
        new Map(
          Object.values(routes.labels ?? {})
            .flatMap((entry) => (entry === 'error' ? [] : entry))
            .map((entry) => [(entry as { name: string }).name, entry as { name: string }])
        ).values()
      )
      const fallbackLabels = distinctLabels.slice(0, 100)
      return new Response(
        JSON.stringify({
          comments: routes.issue?.comments ?? countServed(routes.comments),
          labels: routes.issue?.labels ?? fallbackLabels,
        }),
        { status: 200 }
      )
    }

    const table = href.includes('/comments')
      ? routes.comments
      : href.includes('/labels')
        ? routes.labels
        : undefined

    const body = table?.[page]
    if (body === undefined || body === 'error') return new Response('upstream failure', { status: 502 })
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

function clientWith(routes: Routes) {
  const fetchImpl = pagedFetch(routes)
  const client = new RestGitHubClient({
    token: 'ghp_test',
    repository: REPO,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { client, fetchImpl }
}

function rawComment(id: number, body = `comment ${id}`, login = 'someone') {
  return { id, body, created_at: FIXED_NOW.toISOString(), user: { login } }
}

const fullCommentPage = Array.from({ length: ITEMS_PER_PAGE }, (_unused, index) =>
  rawComment(index + 1)
)

function markerComment(id: number, event: LedgerEvent, login = TRUSTED_LEDGER_AUTHORS[0]) {
  return { id, body: renderEventComment(event), created_at: FIXED_NOW.toISOString(), user: { login } }
}

const stateChange: LedgerEvent = {
  schema_version: 'v1',
  run_id: 'run-1',
  at: FIXED_NOW.toISOString(),
  event: 'state_changed',
  from: 'CLAUDE_TURN',
  to: 'WAITING_HUMAN',
  reason: 'the event that only exists on page two',
  wait: { id: 'wait-7', blocking_reason: 'policy_violation' },
  consumed_wait_id: null,
}

// ─────────────────────────────────────────────────────────────────────────────
// Comments: the event ledger
// ─────────────────────────────────────────────────────────────────────────────

describe('issue comments beyond the first hundred', () => {
  it('reads past 100 instead of stopping at the first page', async () => {
    const { client, fetchImpl } = clientWith({
      comments: { 1: fullCommentPage, 2: [rawComment(101)] },
    })

    const page = await client.listIssueComments(860)

    expect(page.comment_count).toBe(101)
    expect(page.pages_read).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // issue pre-fetch + two pages
  })

  it('sees a ledger event that only exists on page two', async () => {
    // The failure this exists for: the newest events are the ones a truncated
    // read drops, and the newest events are the ones that matter.
    const { client } = clientWith({
      comments: { 1: fullCommentPage, 2: [markerComment(101, stateChange)] },
    })
    const ledger = new IssueCommentLedger(client, { issueNumber: 860, trust: TRUST, dryRun: false })

    const result = await ledger.read()

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ event: 'state_changed', to: 'WAITING_HUMAN' })
    expect(result.pages_read).toBe(2)
    expect(result.comment_count).toBe(101)
  })

  it('would have missed that event on the first page alone — the control', async () => {
    const { client } = clientWith({ comments: { 1: fullCommentPage.slice(0, 50) } })
    const ledger = new IssueCommentLedger(client, { issueNumber: 860, trust: TRUST, dryRun: false })

    expect((await ledger.read()).events).toHaveLength(0)
  })

  it('preserves creation order across the page boundary', async () => {
    // The fold reads meaning from position: `resumeFromWaitingHuman` decides
    // whether an authorization came *after* its wait by index. Reordering the
    // read would change what the ledger means, not just how it looks.
    const { client } = clientWith({
      comments: {
        1: Array.from({ length: ITEMS_PER_PAGE }, (_unused, index) => rawComment(index + 1)),
        2: [rawComment(101), rawComment(102)],
      },
    })

    const page = await client.listIssueComments(860)
    const ids = page.comments.map((comment) => comment.id)

    expect(ids).toEqual([...Array.from({ length: 102 }, (_unused, index) => index + 1)])
  })

  it('imposes creation order itself rather than asking the API for it', async () => {
    // An earlier version sent `sort=created&direction=asc` and called it
    // load-bearing. This endpoint does not document those parameters, so an
    // unrecognised one is simply ignored — the guarantee was imaginary. Sorting
    // on the monotonically increasing comment id cannot be silently dropped.
    const { client, fetchImpl } = clientWith({
      comments: { 1: [rawComment(30), rawComment(10), rawComment(20)] },
    })

    const page = await client.listIssueComments(860)

    expect(page.comments.map((comment) => comment.id)).toEqual([10, 20, 30])
    for (const call of fetchImpl.mock.calls) {
      expect(String(call[0])).not.toContain('sort=')
    }
  })

  it('drops a duplicate id without dropping the entry it duplicates', async () => {
    const { client } = clientWith({
      comments: { 1: fullCommentPage, 2: [rawComment(100, 'a repeat'), rawComment(101)] },
    })

    const page = await client.listIssueComments(860)

    expect(page.comment_count).toBe(101)
    expect(page.comments.filter((comment) => comment.id === 100)).toHaveLength(1)
    expect(page.comments.find((comment) => comment.id === 100)?.body).toBe('comment 100')
  })
})

describe('a ledger that shifts under the walk is caught, not silently truncated', () => {
  it('throws when fewer comments come back than the issue says it has', async () => {
    // The deletion case, and the one ordering cannot help with. Deleting an early
    // comment between two page requests shifts every later entry onto a lower
    // offset: the walk skips one, the shortfall arrives as a short final page,
    // and no duplicate appears for the dedupe to notice. Only the issue's own
    // `comments` count distinguishes it from a genuine end of list.
    const { client } = clientWith({
      comments: { 1: fullCommentPage, 2: [rawComment(102), rawComment(103)] },
      issue: { comments: 103 },
    })

    await expect(client.listIssueComments(860)).rejects.toThrow(
      /read 102 entries but the API reported at least 103/
    )
  })

  it('refuses to fold a ledger it could not read completely', async () => {
    const { client } = clientWith({
      comments: { 1: fullCommentPage, 2: [markerComment(102, stateChange)] },
      issue: { comments: 150 },
    })
    const ledger = new IssueCommentLedger(client, { issueNumber: 860, trust: TRUST, dryRun: false })

    // Better to stop than to rebuild the run from a history missing 48 events.
    await expect(ledger.read()).rejects.toThrow(/entries were skipped/)
  })

  it('accepts a ledger that grew during the walk', async () => {
    // Appends land past the end, so nothing is skipped; reading more than the
    // pre-walk count is a bonus, not a gap.
    const { client } = clientWith({
      comments: { 1: fullCommentPage, 2: [rawComment(101)] },
      issue: { comments: 100 },
    })

    await expect(client.listIssueComments(860)).resolves.toMatchObject({ comment_count: 101 })
  })

  it('throws when the label walk returns fewer labels than the issue carries', async () => {
    // Same shape, worse consequence: the label a shifted walk skips can be the
    // kill switch, and a missing kill switch reads as "keep spending".
    // The issue payload lists 4 labels; the walk only manages to see 2.
    const { client } = clientWith({
      labels: { 1: [{ name: 'a' }, { name: 'b' }] },
      issue: {
        labels: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: KILL_SWITCH_LABEL }],
      },
    })

    await expect(client.listIssueLabels(860)).rejects.toThrow(
      /read 2 entries but the API reported at least 4/
    )
  })

  it('accepts a label walk that matches the issue payload — the positive control', async () => {
    const { client } = clientWith({
      labels: { 1: [{ name: 'a' }, { name: KILL_SWITCH_LABEL }] },
      issue: { labels: [{ name: 'a' }, { name: KILL_SWITCH_LABEL }] },
    })

    await expect(client.listIssueLabels(860)).resolves.toEqual(['a', KILL_SWITCH_LABEL])
  })

  it('accepts an exact match — the positive control', async () => {
    const { client } = clientWith({
      comments: { 1: [rawComment(1), rawComment(2)] },
      issue: { comments: 2 },
    })

    await expect(client.listIssueComments(860)).resolves.toMatchObject({ comment_count: 2 })
  })
})

describe('a failed comment page is a failure, never a shorter ledger', () => {
  it('throws when page two cannot be read', async () => {
    const { client } = clientWith({ comments: { 1: fullCommentPage, 2: 'error' } })
    await expect(client.listIssueComments(860)).rejects.toThrow(/502/)
  })

  it('stops the ledger read rather than folding a partial history', async () => {
    const { client } = clientWith({ comments: { 1: fullCommentPage, 2: 'error' } })
    const ledger = new IssueCommentLedger(client, { issueNumber: 860, trust: TRUST, dryRun: false })

    await expect(ledger.read()).rejects.toThrow()
  })

  it('refuses an Issue longer than the page budget', async () => {
    const pages: Record<number, Page> = {}
    for (let page = 1; page <= MAX_ISSUE_COMMENT_PAGES + 1; page += 1) {
      pages[page] = Array.from({ length: ITEMS_PER_PAGE }, (_unused, index) =>
        rawComment(page * 1000 + index)
      )
    }
    const { client } = clientWith({ comments: pages })

    await expect(client.listIssueComments(860)).rejects.toThrow(/refusing to treat a/)
  })

  it('succeeds on a single short page — the positive control', async () => {
    const { client, fetchImpl } = clientWith({ comments: { 1: [rawComment(1)] } })
    await expect(client.listIssueComments(860)).resolves.toMatchObject({
      comment_count: 1,
      pages_read: 1,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2) // issue pre-fetch + one page
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Labels: the kill switch
// ─────────────────────────────────────────────────────────────────────────────

const fullLabelPage = Array.from({ length: ITEMS_PER_PAGE }, (_unused, index) => ({
  name: `label-${index}`,
}))

describe('the kill switch label cannot hide on page two', () => {
  it('finds the stop label at position 101', async () => {
    const { client } = clientWith({
      labels: { 1: fullLabelPage, 2: [{ name: KILL_SWITCH_LABEL }] },
    })

    const labels = await client.listIssueLabels(860)

    expect(labels).toContain(KILL_SWITCH_LABEL)
    expect(
      evaluateKillSwitch({
        workflowEnabledInput: true,
        env: { ME2_ORCHESTRATOR_ENABLED: 'true' },
        issueLabels: labels,
      }).stopped
    ).toBe(true)
  })

  it('would have missed it on the first page alone — the control', () => {
    // Proves the previous test exercises pagination and not something else.
    expect(
      evaluateKillSwitch({
        workflowEnabledInput: true,
        env: { ME2_ORCHESTRATOR_ENABLED: 'true' },
        issueLabels: fullLabelPage.map((label) => label.name),
      }).stopped
    ).toBe(false)
  })

  it('throws when a label page cannot be read, rather than reporting no stop label', async () => {
    // Failing open here would be the worst outcome in the module: the run would
    // conclude the kill switch is absent and carry on spending.
    const { client } = clientWith({ labels: { 1: fullLabelPage, 2: 'error' } })
    await expect(client.listIssueLabels(860)).rejects.toThrow(/502/)
  })

  it('refuses a label set longer than the page budget', async () => {
    const pages: Record<number, Page> = {}
    for (let page = 1; page <= MAX_ISSUE_LABEL_PAGES + 1; page += 1) {
      pages[page] = Array.from({ length: ITEMS_PER_PAGE }, (_unused, index) => ({
        name: `p${page}-label-${index}`,
      }))
    }
    const { client } = clientWith({ labels: pages })

    await expect(client.listIssueLabels(860)).rejects.toThrow(/refusing to treat a/)
  })

  it('deduplicates repeated label names', async () => {
    const { client } = clientWith({
      labels: { 1: fullLabelPage, 2: [{ name: 'label-0' }, { name: KILL_SWITCH_LABEL }] },
    })

    const labels = await client.listIssueLabels(860)

    expect(labels.filter((name) => name === 'label-0')).toHaveLength(1)
    expect(labels).toContain(KILL_SWITCH_LABEL)
  })

  it('reads one page when there is only one — the positive control', async () => {
    const { client, fetchImpl } = clientWith({ labels: { 1: [{ name: 'enhancement' }] } })
    await expect(client.listIssueLabels(860)).resolves.toEqual(['enhancement'])
    expect(fetchImpl).toHaveBeenCalledTimes(2) // issue pre-fetch + one page
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The property that has to hold for all three walks
// ─────────────────────────────────────────────────────────────────────────────

describe('no safe read returns a partial answer', () => {
  it('has no unpaginated per_page request left in the client', () => {
    const source = readFileSync(
      join(process.cwd(), 'tools/ai-orchestrator/src/adapters/github/rest-client.ts'),
      'utf8'
    )

    // Every list read goes through `readAllPages`; a fresh `per_page=` outside it
    // would be a fourth chance to reintroduce the same defect. Checked against
    // executable content, since prose is allowed to discuss the old mistake.
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const perPageLiterals = executable.match(/per_page=/g) ?? []
    expect(perPageLiterals).toHaveLength(1)
    expect(executable).toContain('per_page=${ITEMS_PER_PAGE}&page=${page}')
  })
})
