import { describe, expect, it, vi } from 'vitest'
import type { CardClicker } from '@/lib/confirmation-card'
import { handleDrawerSpendTurn } from '../drawer-spend-turn'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const STAFF: CardClicker = { kind: 'client_staff', email: 'staff@example.com' }

vi.mock('@/lib/confirmation-card', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/confirmation-card')>()
  return {
    ...actual,
    issueConfirmationCard: vi.fn(async () => ({ what: '开投', confirmEnabled: false })),
  }
})

import { issueConfirmationCard } from '@/lib/confirmation-card'

const issue = vi.mocked(issueConfirmationCard)

describe('drawer spend turn', () => {
  it('does not issue a card or a click for chat words', async () => {
    issue.mockClear()
    const broken = { from() { throw new Error('no') } }
    const outcome = await handleDrawerSpendTurn({
      supabase: broken as never,
      kernel: {} as never,
      clientId: CLIENT,
      clicker: OPC,
      message: '确认',
    })
    expect(outcome).toMatchObject({ kind: 'reply', status: 200 })
    if (outcome.kind !== 'reply') return
    expect(outcome.body.executed).toBe(false)
    expect(outcome.body.reply).toContain('不算')
    expect(issue).not.toHaveBeenCalled()
  })

  it('lets ordinary chat pass through', async () => {
    const outcome = await handleDrawerSpendTurn({
      supabase: {} as never,
      kernel: {} as never,
      clientId: CLIENT,
      clicker: OPC,
      message: '现在最该先推进什么',
    })
    expect(outcome.kind).toBe('pass')
  })

  it('refuses a client employee without issuing a card', async () => {
    issue.mockClear()
    const outcome = await handleDrawerSpendTurn({
      supabase: {} as never,
      kernel: {} as never,
      clientId: CLIENT,
      clicker: STAFF,
      message: '开投',
    })
    expect(outcome).toMatchObject({ kind: 'reply', body: { executed: false } })
    if (outcome.kind !== 'reply') return
    expect(outcome.body.reply).toContain('客户员工')
    expect(issue).not.toHaveBeenCalled()
  })

  it('issues a card for a launch order and marks it not executed', async () => {
    issue.mockClear()
    const outcome = await handleDrawerSpendTurn({
      supabase: { from() { throw new Error('no') } } as never,
      kernel: {} as never,
      clientId: CLIENT,
      clicker: OPC,
      message: '开投，每天 100',
    })
    expect(issue).toHaveBeenCalledTimes(1)
    const facts = issue.mock.calls[0]?.[1].facts
    expect(facts.what).toBe('开投')
    expect(facts.scope).toContain('只出卡，不执行')
    expect(facts.hardChecks.map((check) => check.label)).toEqual([
      '日上限', '线索进 CRM', '素材已批准', '系列归属', '确认卡', '内部账号',
    ])
    expect(outcome).toMatchObject({ kind: 'reply', body: { executed: false, held: true } })
  })
})
