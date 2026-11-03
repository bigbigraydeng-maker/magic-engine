import { describe, expect, it, vi } from 'vitest'

import type { CalendarReadResult } from '../calendar-client'
import type { LedgerCardView } from '../classify'
import type { LedgerView } from '../ledger-view'
import type { ProbeDeps } from '../probes'
import { nzTodayDate, runCalendarClosureAudit, type AuditDeps, type AuditOptions } from '../run-audit'
import type { CalendarEvent } from '../types'

const TODAY = '2026-10-08'

function makeEvent(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    title: '事件',
    description: '',
    startNz: TODAY,
    htmlLink: `https://example.test/${overrides.id}`,
    etag: null,
    updated: null,
    ...overrides,
  }
}

function makeCard(overrides: Partial<LedgerCardView> & { id: string }): LedgerCardView {
  return {
    status: 'decided',
    verifiedRef: null,
    ...overrides,
  }
}

interface Harness {
  deps: AuditDeps
  readEvents: ReturnType<typeof vi.fn>
  buildLedgerView: ReturnType<typeof vi.fn>
  loadCronRuns: ReturnType<typeof vi.fn>
  loadCommentRun: ReturnType<typeof vi.fn>
  clientExists: ReturnType<typeof vi.fn>
  newRequestId: ReturnType<typeof vi.fn>
}

function makeHarness(opts: {
  events?: CalendarEvent[]
  cards?: Map<string, LedgerCardView>
  coveredLedgerIds?: Set<string>
  readError?: Error
  ledgerError?: Error
  cronRuns?: { status: string | null; started_at: string }[]
  commentRun?: { finished_at: string | null; results: never[] } | null
  clientExists?: boolean
}): Harness {
  const events = opts.events ?? []
  const cards = opts.cards ?? new Map<string, LedgerCardView>()
  const coveredLedgerIds = opts.coveredLedgerIds ?? new Set<string>()

  const readEvents = vi.fn(async (_todayNz: string): Promise<CalendarReadResult> => {
    if (opts.readError) throw opts.readError
    return { events, proof: { etag: 'etag-1', updated: '2026-10-08T00:00:00Z' } }
  })

  const buildLedgerView = vi.fn((_todayNz: string): LedgerView => {
    if (opts.ledgerError) throw opts.ledgerError
    return { cards, coveredLedgerIds, parseErrorCount: 0 }
  })

  const loadCronRuns = vi.fn(async () => opts.cronRuns ?? [])
  const loadCommentRun = vi.fn(async () => opts.commentRun ?? null)
  const clientExists = vi.fn(async () => opts.clientExists ?? true)
  const newRequestId = vi.fn(() => 'req-1')

  const probeDeps: Omit<ProbeDeps, 'loadCard'> = {
    now: () => new Date('2026-10-08T00:00:00Z'),
    loadCronRuns,
    allowedJobs: new Set(['social-comment-autoreply']),
    loadCommentRun,
    loadReplyScopeTodos: vi.fn(async () => []),
    clientExists,
  }

  const deps: AuditDeps = {
    now: () => new Date('2026-10-08T00:00:00Z'),
    readEvents,
    buildLedgerView,
    probeDeps,
    newRequestId,
  }

  return {
    deps,
    readEvents,
    buildLedgerView,
    loadCronRuns,
    loadCommentRun,
    clientExists,
    newRequestId,
  }
}

const DRY: AuditOptions = { dryRun: true, source: 'live' }

describe('nzTodayDate', () => {
  it('formats an instant as a New Zealand date', () => {
    // 2026-10-07T12:00:00Z 在新西兰是 2026-10-08
    expect(nzTodayDate(new Date('2026-10-07T12:00:00Z'))).toBe('2026-10-08')
  })
})

describe('runCalendarClosureAudit', () => {
  it('happy path: auto/human/no_ledger/closed/covered', async () => {
    const autoId = '2026-10-01-auto-card'
    const humanId = '2026-10-01-human-card'
    const closedId = '2026-10-01-closed-card'
    const coveredId = '2026-10-01-covered-card'

    const events: CalendarEvent[] = [
      makeEvent({
        id: 'ev-auto',
        title: '自动核对',
        description: `ledger-id: ${autoId}\nprobe: cron_run_ok job=social-comment-autoreply within_hours=24`,
      }),
      makeEvent({
        id: 'ev-human',
        title: '要人核',
        description: `ledger-id: ${humanId}`,
      }),
      makeEvent({
        id: 'ev-no-ledger',
        title: '没有台账',
        description: '随便写点什么',
      }),
      makeEvent({
        id: 'ev-closed',
        title: '✅ 已闭环',
        description: `ledger-id: ${closedId}`,
      }),
      makeEvent({
        id: 'ev-covered',
        title: '台账栏已出待办',
        description: `ledger-id: ${coveredId}`,
      }),
    ]

    const cards = new Map<string, LedgerCardView>([
      [autoId, makeCard({ id: autoId })],
      [humanId, makeCard({ id: humanId })],
      [closedId, makeCard({ id: closedId })],
      [coveredId, makeCard({ id: coveredId })],
    ])

    const h = makeHarness({
      events,
      cards,
      coveredLedgerIds: new Set([coveredId]),
      cronRuns: [{ status: 'completed', started_at: '2026-10-08T00:00:00Z' }],
    })

    const receipt = await runCalendarClosureAudit(h.deps, DRY)

    expect(receipt.status).toBe('ok')
    expect(receipt.candidates).toBe(5)
    expect(receipt.processed).toBe(5)
    expect(receipt.deferred).toBe(0)
    expect(receipt.no_publish).toBe(true)
    expect(receipt.writes_enabled).toBe(false)
    expect(receipt.not_evidence).toBe(true) // dry_run

    const byId = new Map(receipt.results.map((r) => [r.eventId, r]))
    expect(byId.get('ev-auto')?.kind).toBe('probe_passed')
    expect(byId.get('ev-human')?.kind).toBe('needs_human')
    expect(byId.get('ev-no-ledger')?.kind).toBe('no_ledger')
    expect(byId.get('ev-closed')?.kind).toBe('closed')
    expect(byId.get('ev-covered')?.kind).toBe('covered')

    // 第一步从不叫 verified
    for (const r of receipt.results) {
      expect(r.kind).not.toBe('verified')
    }
  })

  it('readEvents throws -> calendar_unreadable, no probe called', async () => {
    const h = makeHarness({ readError: new Error('boom') })
    const receipt = await runCalendarClosureAudit(h.deps, DRY)

    expect(receipt.status).toBe('calendar_unreadable')
    expect(receipt.error).toBe('boom')
    expect(receipt.results).toEqual([])
    expect(receipt.processed).toBe(0)
    expect(receipt.candidates).toBe(0)
    expect(receipt.deferred).toBe(0)
    expect(receipt.read_proof).toBeNull()
    expect(h.loadCronRuns).not.toHaveBeenCalled()
    expect(h.loadCommentRun).not.toHaveBeenCalled()
    expect(h.clientExists).not.toHaveBeenCalled()
  })

  it('buildLedgerView throws -> ledger_unreadable', async () => {
    const h = makeHarness({ ledgerError: new Error('no ledger') })
    const receipt = await runCalendarClosureAudit(h.deps, DRY)

    expect(receipt.status).toBe('ledger_unreadable')
    expect(receipt.error).toBe('no ledger')
    expect(receipt.results).toEqual([])
    expect(receipt.processed).toBe(0)
  })

  it('non-dry-run with onlyEventId throws', async () => {
    const h = makeHarness({})
    await expect(
      runCalendarClosureAudit(h.deps, { dryRun: false, source: 'live', onlyEventId: 'ev-1' }),
    ).rejects.toThrow('override options are dry_run only')
  })

  it('bad todayOverride throws', async () => {
    const h = makeHarness({})
    await expect(
      runCalendarClosureAudit(h.deps, { dryRun: true, source: 'live', todayOverride: 'nope' }),
    ).rejects.toThrow('bad todayOverride')
  })

  it('dry-run override with a valid line runs the override probe', async () => {
    const id = '2026-10-01-human-card'
    const events = [makeEvent({ id: 'ev-1', title: '要人核', description: `ledger-id: ${id}` })]
    const cards = new Map<string, LedgerCardView>([[id, makeCard({ id })]])
    const h = makeHarness({
      events,
      cards,
      cronRuns: [{ status: 'completed', started_at: '2026-10-08T00:00:00Z' }],
    })

    const receipt = await runCalendarClosureAudit(h.deps, {
      dryRun: true,
      source: 'live',
      onlyEventId: 'ev-1',
      probeOverrideLine: 'cron_run_ok job=social-comment-autoreply within_hours=24',
    })

    expect(receipt.results).toHaveLength(1)
    expect(receipt.results[0].kind).toBe('probe_passed')
    expect(h.loadCronRuns).toHaveBeenCalledTimes(1)
  })

  it('ledger_card_status 的 id 必须等于事件自己的 ledger-id，否则 unreadable（不许借自己的编号探别的卡）', async () => {
    const id = '2026-10-01-human-card'
    const other = '2026-10-02-other-card'
    const events = [makeEvent({ id: 'ev-1', title: '要人核', description: `ledger-id: ${id}` })]
    const cards = new Map<string, LedgerCardView>([
      [id, makeCard({ id }) ],
      [other, makeCard({ id: other, status: 'verified' })],
    ])
    const h = makeHarness({ events, cards })

    const receipt = await runCalendarClosureAudit(h.deps, {
      dryRun: true,
      source: 'live',
      onlyEventId: 'ev-1',
      probeOverrideLine: `ledger_card_status id=${other} status=verified`,
    })

    expect(receipt.results[0].kind).toBe('probe_unreadable')
    expect(receipt.results[0].fact).toContain('不一致')
  })

  it('override with an invalid line -> probe_unreadable', async () => {
    const id = '2026-10-01-human-card'
    const events = [makeEvent({ id: 'ev-1', title: '要人核', description: `ledger-id: ${id}` })]
    const cards = new Map<string, LedgerCardView>([[id, makeCard({ id })]])
    const h = makeHarness({ events, cards })

    const receipt = await runCalendarClosureAudit(h.deps, {
      dryRun: true,
      source: 'live',
      onlyEventId: 'ev-1',
      probeOverrideLine: 'not_a_probe foo=bar',
    })

    expect(receipt.results).toHaveLength(1)
    expect(receipt.results[0].kind).toBe('probe_unreadable')
    expect(receipt.results[0].fact).toContain('覆盖的 probe 不合格')
    expect(h.loadCronRuns).not.toHaveBeenCalled()
  })

  it('onlyEventId filters events', async () => {
    const id = '2026-10-01-human-card'
    const events = [
      makeEvent({ id: 'ev-1', title: '要人核', description: `ledger-id: ${id}` }),
      makeEvent({ id: 'ev-2', title: '没有台账', description: 'x' }),
    ]
    const cards = new Map<string, LedgerCardView>([[id, makeCard({ id })]])
    const h = makeHarness({ events, cards })

    const receipt = await runCalendarClosureAudit(h.deps, {
      dryRun: true,
      source: 'live',
      onlyEventId: 'ev-1',
    })

    expect(receipt.results).toHaveLength(1)
    expect(receipt.results[0].eventId).toBe('ev-1')
  })

  it('fixture source -> not_evidence true', async () => {
    const h = makeHarness({})
    const receipt = await runCalendarClosureAudit(h.deps, { dryRun: false, source: 'fixture' })

    expect(receipt.status).toBe('ok')
    expect(receipt.not_evidence).toBe(true)
    expect(receipt.no_publish).toBe(true)
    expect(receipt.writes_enabled).toBe(false)
  })

  it('every receipt has no_publish true and writes_enabled false', async () => {
    const ok = await runCalendarClosureAudit(makeHarness({}).deps, DRY)
    const cal = await runCalendarClosureAudit(
      makeHarness({ readError: new Error('x') }).deps,
      DRY,
    )
    const led = await runCalendarClosureAudit(
      makeHarness({ ledgerError: new Error('y') }).deps,
      DRY,
    )

    for (const receipt of [ok, cal, led]) {
      expect(receipt.no_publish).toBe(true)
      expect(receipt.writes_enabled).toBe(false)
    }
  })
})
