import { describe, expect, it } from 'vitest'

import { detectWatchFindings } from '../daily-watch'
import type { PromoBoard } from '../board'
import type { ApprovalVerdict, GateResult } from '../gates'
import type { Reconciliation, ReconcileRow } from '../reconcile'

// ─── 夹具 ──────────────────────────────────────────────────────────────────────

function makeBoard(overrides: Partial<PromoBoard>): PromoBoard {
  const base: PromoBoard = {
    plan_id: 'plan-1',
    plan_status: 'draft',
    updated_at: null,
    has_promo: true,
    spec_valid: true,
    issues: [],
    today: '2024-06-10',
    timezone_known: true,
    playbook: null,
    approval: null,
    next_phase: null,
    reconcile: null,
    reviewed_this_window: false,
    content_changed: false,
  }
  return { ...base, ...overrides }
}

function makeApproval(overrides: Partial<ApprovalVerdict>): ApprovalVerdict {
  const base: ApprovalVerdict = {
    can_approve: true,
    blockers: [],
    unverified: [],
    results: [],
    per_phase: [],
    deferred_blockers: [],
    note: null,
  }
  return { ...base, ...overrides }
}

function makeGateResult(overrides: Partial<GateResult>): GateResult {
  const base: GateResult = {
    phase_id: 'phase-1',
    phase_name: '第一阶段',
    label: '预算已填',
    reason: '还没填预算',
    how: '打开推广计划页，把预算填上。',
    light: 'red',
    key: 'ads.cap_set',
    group: 'tool',
    hard: true,
    evidence: 'unvalidated_default',
    as_of: null,
  }
  return { ...base, ...overrides }
}

function makeRow(overrides: Partial<ReconcileRow>): ReconcileRow {
  const base: ReconcileRow = {
    key: 'spend',
    label: '广告花费',
    planned: 10000,
    actual: 10000,
    unit: '分',
    status: 'on_track',
    reason: '实际是计划的 100%',
    as_of: '2024-06-10T08:30:00Z',
  }
  return { ...base, ...overrides }
}

function makeReconcile(overrides: Partial<Reconciliation>): Reconciliation {
  const base: Reconciliation = {
    window: { start: '2024-06-01', end: '2024-06-07' },
    week_index: 1,
    rows: [],
    headline: '第 1 周 · 基本按计划',
    blind: false,
  }
  return { ...base, ...overrides }
}

const PLAN = { title: '六月推广' }

// ─── 用例 ──────────────────────────────────────────────────────────────────────

describe('detectWatchFindings', () => {
  it('草稿 + can_approve → 一条 draft_ready_to_approve，how 里有「本人另外点头」', () => {
    const board = makeBoard({
      plan_status: 'draft',
      approval: makeApproval({ can_approve: true, unverified: [] }),
    })
    const findings = detectWatchFindings(board, PLAN)
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('draft_ready_to_approve')
    expect(findings[0].how).toContain('本人另外点头')
  })

  it('草稿 + can_approve + 有 unverified → what 里提到项数', () => {
    const board = makeBoard({
      plan_status: 'draft',
      approval: makeApproval({
        can_approve: true,
        unverified: [
          makeGateResult({ label: '依据已核实' }),
          makeGateResult({ label: '受众已核实' }),
        ],
      }),
    })
    const findings = detectWatchFindings(board, PLAN)
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('draft_ready_to_approve')
    expect(findings[0].what).toContain('2 项')
  })

  it('草稿但 can_approve=false → []', () => {
    const board = makeBoard({
      plan_status: 'draft',
      approval: makeApproval({ can_approve: false }),
    })
    expect(detectWatchFindings(board, PLAN)).toEqual([])
  })

  it('没有 promo → []', () => {
    const board = makeBoard({ has_promo: false })
    expect(detectWatchFindings(board, PLAN)).toEqual([])
  })

  it('spec_valid=false → []', () => {
    const board = makeBoard({ spec_valid: false })
    expect(detectWatchFindings(board, PLAN)).toEqual([])
  })

  it('已批准 + content_changed → approved_content_changed', () => {
    const board = makeBoard({ plan_status: 'approved', content_changed: true })
    const findings = detectWatchFindings(board, PLAN)
    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('approved_content_changed')
  })

  it('已批准 + blockers → phase_gate_failed，what 带阶段名', () => {
    const board = makeBoard({
      plan_status: 'approved',
      approval: makeApproval({
        can_approve: false,
        blockers: [makeGateResult({ phase_name: '第一阶段', label: '预算已填', reason: '还没填预算' })],
      }),
    })
    const findings = detectWatchFindings(board, PLAN)
    const gate = findings.find(f => f.code === 'phase_gate_failed')
    expect(gate).toBeDefined()
    expect(gate?.what).toContain('第一阶段')
  })

  it('已批准 + 超过 3 条 blockers → what 写「等共 N 项」', () => {
    const blockers = [
      makeGateResult({ label: 'A' }),
      makeGateResult({ label: 'B' }),
      makeGateResult({ label: 'C' }),
      makeGateResult({ label: 'D' }),
      makeGateResult({ label: 'E' }),
    ]
    const board = makeBoard({
      plan_status: 'approved',
      approval: makeApproval({ can_approve: false, blockers }),
    })
    const findings = detectWatchFindings(board, PLAN)
    const gate = findings.find(f => f.code === 'phase_gate_failed')
    expect(gate?.what).toContain('等共 5 项')
  })

  it('已批准 + 对账 behind → reconcile_deviation，what 含取数时间', () => {
    const board = makeBoard({
      plan_status: 'approved',
      reconcile: makeReconcile({
        rows: [makeRow({ status: 'behind', as_of: '2024-06-10T08:30:00Z' })],
      }),
    })
    const findings = detectWatchFindings(board, PLAN)
    const dev = findings.find(f => f.code === 'reconcile_deviation')
    expect(dev).toBeDefined()
    expect(dev?.what).toContain('取数时间 2024-06-10 08:30')
  })

  it('已批准 + 对账 behind 且没有取数时间 → what 含「没有取数时间」', () => {
    const board = makeBoard({
      plan_status: 'approved',
      reconcile: makeReconcile({
        rows: [makeRow({ status: 'over', as_of: null })],
      }),
    })
    const findings = detectWatchFindings(board, PLAN)
    const dev = findings.find(f => f.code === 'reconcile_deviation')
    expect(dev?.what).toContain('没有取数时间')
  })

  it('content 行 actual=0 planned>0 → what 含「分不清」', () => {
    const board = makeBoard({
      plan_status: 'approved',
      reconcile: makeReconcile({
        rows: [
          makeRow({
            key: 'content',
            label: '本周发布的社媒内容',
            planned: 5,
            actual: 0,
            unit: '条',
            status: 'behind',
            reason: '只发了计划的 0%',
          }),
        ],
      }),
    })
    const findings = detectWatchFindings(board, PLAN)
    const dev = findings.find(f => f.code === 'reconcile_deviation')
    expect(dev?.what).toContain('分不清')
  })

  it('已批准 + 对账 unknown → reconcile_blind，what 含「看不清不等于正常」', () => {
    const board = makeBoard({
      plan_status: 'approved',
      reconcile: makeReconcile({
        rows: [makeRow({ status: 'unknown', actual: null, reason: '广告花费读不出来' })],
      }),
    })
    const findings = detectWatchFindings(board, PLAN)
    const blind = findings.find(f => f.code === 'reconcile_blind')
    expect(blind).toBeDefined()
    expect(blind?.what).toContain('看不清不等于正常')
  })

  it('已批准 + 花费读不到（核心行 unknown）→ reconcile_blind', () => {
    const board = makeBoard({
      plan_status: 'approved',
      reconcile: makeReconcile({ rows: [makeRow({ key: 'spend', status: 'unknown', actual: null, reason: '广告花费读不出来' })], blind: true }),
    })
    const findings = detectWatchFindings(board, PLAN)
    const blind = findings.find(f => f.code === 'reconcile_blind')
    expect(blind).toBeDefined()
    expect(blind?.what).toContain('看不清不等于正常')
  })

  it('计划还没开始（week_index 为空）→ 不出任何对账类待办', () => {
    const board = makeBoard({
      plan_status: 'approved',
      reconcile: { ...makeReconcile({ rows: [makeRow({ key: 'spend', status: 'unknown', actual: null, reason: '广告花费读不出来' }), makeRow({ status: 'behind' })], blind: true }), week_index: null },
    })
    expect(detectWatchFindings(board, PLAN)).toEqual([])
  })

  it('目标不适用 / 窗口里没有生效的广告步骤 → 是确定状态，不报「看不清」', () => {
    const board = makeBoard({
      plan_status: 'approved',
      reconcile: makeReconcile({ rows: [
        makeRow({ key: 'results_goal', status: 'unknown', actual: null, planned: null, reason: '目标不适用（状态：completed）' }),
        makeRow({ key: 'spend', status: 'unknown', actual: null, reason: '这个窗口内没有生效的广告步骤（可能在暂停区间或阶段之外）' }),
      ], blind: true }),
    })
    expect(detectWatchFindings(board, PLAN).find(f => f.code === 'reconcile_blind')).toBeUndefined()
  })

  it('广告平台自报结果那一行读不到，不算核心行，不报「看不清」', () => {
    const board = makeBoard({
      plan_status: 'approved',
      reconcile: makeReconcile({ rows: [makeRow({ key: 'results_meta', status: 'unknown', actual: null, reason: '广告平台结果读不出来' })], blind: false }),
    })
    expect(detectWatchFindings(board, PLAN)).toEqual([])
  })

  it('已批准但推广结构读不出来 → plan_structure_unreadable；草稿读不出来不吵', () => {
    const approved = makeBoard({ plan_status: 'approved', spec_valid: false })
    expect(detectWatchFindings(approved, PLAN).map(f => f.code)).toEqual(['plan_structure_unreadable'])
    const draft = makeBoard({ plan_status: 'draft', spec_valid: false })
    expect(detectWatchFindings(draft, PLAN)).toEqual([])
  })

  it('已批准全部正常 → []', () => {
    const board = makeBoard({
      plan_status: 'approved',
      approval: makeApproval({ can_approve: true, blockers: [] }),
      reconcile: makeReconcile({
        rows: [makeRow({ status: 'on_track' })],
        blind: false,
      }),
    })
    expect(detectWatchFindings(board, PLAN)).toEqual([])
  })

  it('所有 what/how 都不含内部词', () => {
    const forbidden = ['migration', 'schema', 'cron', 'token', 'webhook']
    const boards: PromoBoard[] = [
      makeBoard({ plan_status: 'draft', approval: makeApproval({ can_approve: true }) }),
      makeBoard({ plan_status: 'approved', content_changed: true }),
      makeBoard({
        plan_status: 'approved',
        approval: makeApproval({ can_approve: false, blockers: [makeGateResult({})] }),
      }),
      makeBoard({
        plan_status: 'approved',
        reconcile: makeReconcile({ rows: [makeRow({ status: 'behind' })] }),
      }),
      makeBoard({
        plan_status: 'approved',
        reconcile: makeReconcile({ rows: [makeRow({ status: 'unknown', actual: null })] }),
      }),
    ]
    for (const board of boards) {
      for (const finding of detectWatchFindings(board, PLAN)) {
        for (const word of forbidden) {
          expect(finding.what).not.toContain(word)
          expect(finding.how).not.toContain(word)
        }
      }
    }
  })
})
