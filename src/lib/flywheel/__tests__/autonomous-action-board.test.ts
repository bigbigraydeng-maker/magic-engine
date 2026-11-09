/**
 * 锁定一条底线规则：账本行 payload.status 若表明这件事并没有真的发生
 * （演练 dry-run、被安全检查拦下、执行失败、被否决、仍在等待人工确认），
 * 就绝不允许在执行看板上显示为 'completed'。
 *
 * 同时锁定可见性规则：客户成员永远看不到 not_done（没做成）、settling（执行中或结果未回写）
 * 与 unknown（认不出来）的行，内部成员则看到诚实的待确认状态，而不是被伪装成已完成。
 */

import { describe, it, expect } from 'vitest'
import {
  resolveAutonomousBoardState,
  boardViewerFor,
  CLIENT_VISIBLE_LEDGER_STATUSES,
  LABEL_UNKNOWN_STATUS,
  type BoardViewer,
} from '@/lib/flywheel/autonomous-action-board'

const VIEWERS: BoardViewer[] = ['internal', 'client']
const DONE = ['active', 'paused', 'executed', 'succeeded', 'live', 'completed']
const IN_FLIGHT = ['pr_open']
const SETTLING = ['activating', 'authorized_pending', 'in_progress']
const AWAITING = ['awaiting_approval', 'pending_approval']
const NOT_DONE = ['blocked', 'failed', 'rejected', 'dry_run_logged', 'meta_failed', 'workflow_failed', 'dead_letter', 'denied']
const UNKNOWN: unknown[] = [
  'queued',
  '',
  'ACTIVE',
  ' paused',
  'constructor',
  'toString',
  '__proto__',
  42,
  true,
  {},
  ['paused'],
  'relation "x" does not exist',
]

describe('账上没写状态的老记录', () => {
  it.each(VIEWERS)('undefined 对 %s 视为已完成', (viewer) => {
    expect(resolveAutonomousBoardState(undefined, viewer)).toEqual({
      status: 'completed',
      label: null,
      disposition: 'done',
    })
  })

  it.each(VIEWERS)('null 对 %s 视为已完成', (viewer) => {
    expect(resolveAutonomousBoardState(null, viewer)).toEqual({
      status: 'completed',
      label: null,
      disposition: 'done',
    })
  })
})

describe('真做完的', () => {
  it.each(DONE)('%s 对两种查看者都显示为已完成', (status) => {
    for (const viewer of VIEWERS) {
      expect(resolveAutonomousBoardState(status, viewer)).toEqual({
        status: 'completed',
        label: null,
        disposition: 'done',
      })
    }
  })
})

describe('正在做的', () => {
  it.each(IN_FLIGHT)('%s 对两种查看者都显示为进行中', (status) => {
    for (const viewer of VIEWERS) {
      expect(resolveAutonomousBoardState(status, viewer)).toEqual({
        status: 'in_progress',
        label: '已提交，等待上线',
        disposition: 'in_flight',
      })
    }
  })
})

describe('执行中或结果没回写的（正常只停几秒，看得到就可能卡住了）', () => {
  it.each(SETTLING)('%s 对内部成员显示为进行中并提示需人工核对', (status) => {
    expect(resolveAutonomousBoardState(status, 'internal')).toEqual({
      status: 'in_progress',
      label: '执行中或结果未回写，久未变化需人工核对',
      disposition: 'settling',
    })
  })

  it.each(SETTLING)('%s 对客户成员一律隐藏', (status) => {
    expect(resolveAutonomousBoardState(status, 'client')).toBeNull()
  })
})

describe('等人确认的', () => {
  it.each(AWAITING)('%s 对两种查看者都显示为待人工确认', (status) => {
    for (const viewer of VIEWERS) {
      expect(resolveAutonomousBoardState(status, viewer)).toEqual({
        status: 'pending',
        label: '等待确认，确认前不会执行',
        disposition: 'awaiting_person',
      })
    }
  })
})

describe('没做成的', () => {
  it.each(NOT_DONE)('%s 对内部成员显示为未完成', (status) => {
    const state = resolveAutonomousBoardState(status, 'internal')
    expect(state?.status).toBe('skipped')
    expect(state?.disposition).toBe('not_done')
    expect(typeof state?.label).toBe('string')
    expect(state?.label).not.toBe('')
  })

  it('blocked 的固定说法是被安全检查拦下', () => {
    expect(resolveAutonomousBoardState('blocked', 'internal')?.label).toBe('未生效：被安全检查拦下')
  })

  it('dry_run_logged 的固定说法是仅演练记录', () => {
    expect(resolveAutonomousBoardState('dry_run_logged', 'internal')?.label).toBe('未执行：仅演练记录')
  })

  it('rejected 的固定说法是已被否决', () => {
    expect(resolveAutonomousBoardState('rejected', 'internal')?.label).toBe('未执行：已被否决')
  })

  it('denied 的固定说法是未获授权', () => {
    expect(resolveAutonomousBoardState('denied', 'internal')?.label).toBe('未执行：未获授权')
  })

  it.each(['failed', 'meta_failed', 'workflow_failed', 'dead_letter'])(
    '%s 的固定说法是结果未确认处理失败待人工核对',
    (status) => {
      expect(resolveAutonomousBoardState(status, 'internal')?.label).toBe(
        '结果未确认：处理失败，待人工核对',
      )
    },
  )

  it.each(NOT_DONE)('%s 对客户成员一律隐藏', (status) => {
    expect(resolveAutonomousBoardState(status, 'client')).toBeNull()
  })
})

describe('认不出来的状态', () => {
  for (const value of UNKNOWN) {
    it(`内部成员看到 ${JSON.stringify(value)} 时标为待确认`, () => {
      expect(resolveAutonomousBoardState(value, 'internal')).toEqual({
        status: 'pending',
        label: LABEL_UNKNOWN_STATUS,
        disposition: 'unknown',
      })
    })

    it(`客户成员看到 ${JSON.stringify(value)} 时一律隐藏`, () => {
      expect(resolveAutonomousBoardState(value, 'client')).toBeNull()
    })
  }

  it('原始输入不会经由 label 泄漏到页面上', () => {
    const state = resolveAutonomousBoardState('relation "x" does not exist', 'internal')
    expect(state?.label).not.toContain('relation')
  })
})

describe('底线：没做完的永远不显示成已完成', () => {
  const NOT_COMPLETED: unknown[] = [...IN_FLIGHT, ...SETTLING, ...AWAITING, ...NOT_DONE, ...UNKNOWN]

  for (const value of NOT_COMPLETED) {
    for (const viewer of VIEWERS) {
      it(`${JSON.stringify(value)} 对 ${viewer} 绝不显示为已完成`, () => {
        const state = resolveAutonomousBoardState(value, viewer)
        expect(state?.status).not.toBe('completed')
      })
    }
  }
})

describe('给查询用的客户可见词表', () => {
  it('只包含真做了的、已提交等上线的、等确认的', () => {
    expect([...CLIENT_VISIBLE_LEDGER_STATUSES].sort()).toEqual(
      [...DONE, ...IN_FLIGHT, ...AWAITING].sort(),
    )
  })

  it.each(CLIENT_VISIBLE_LEDGER_STATUSES)('%s 对客户成员可见', (status) => {
    expect(resolveAutonomousBoardState(status, 'client')).not.toBeNull()
  })

  it.each([...SETTLING, ...NOT_DONE])('%s 不在客户可见词表里', (status) => {
    expect(CLIENT_VISIBLE_LEDGER_STATUSES).not.toContain(status)
  })
})

describe('谁算内部', () => {
  it('全局管理员算内部', () => {
    expect(boardViewerFor({ tier: 'admin', allowedClientId: null })).toBe('internal')
  })

  it('受限管理员（演示 / 试用账号）算客户', () => {
    expect(boardViewerFor({ tier: 'admin', allowedClientId: 'c1' })).toBe('client')
  })

  it('客户成员算客户', () => {
    expect(boardViewerFor({ tier: 'paid_client', allowedClientId: 'c1' })).toBe('client')
  })

  it('自助账号算客户', () => {
    expect(boardViewerFor({ tier: 'self_serve', allowedClientId: 'c1' })).toBe('client')
  })

  it('不带客户限定的非管理员也算客户', () => {
    expect(boardViewerFor({ tier: 'paid_client', allowedClientId: null })).toBe('client')
  })
})
