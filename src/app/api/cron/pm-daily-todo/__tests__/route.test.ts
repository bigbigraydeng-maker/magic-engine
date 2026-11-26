/**
 * 每日待办邮件那条路径：先开广告赢家待办的新一轮（写推送记录），再读待办。
 * 开轮整步挂了不能挡邮件（也不能让推送记录被读路径偷写）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  order: [] as string[],
  openResult: { opened: ['w1'], failed: [] as Array<{ winner_id: string; error: string }> },
  openThrows: false,
  finish: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: async () => ({ finish: h.finish }) }))
vi.mock('@/lib/email/sender', () => ({ meMailFrom: () => 'x@example.com', ME_MAIL_TO_ADDRESS: 'to@example.com' }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: async () => { h.order.push('send'); return { error: null } } }
  },
}))
vi.mock('@/lib/pm-todo/daily-todo', () => ({
  nzWeekday: () => 2,
  loadTodoCounts: async () => { h.order.push('load'); return {} },
  buildTodoEmail: () => ({ subject: 's', html: '<p/>', totalItems: 3 }),
}))
vi.mock('@/lib/pm-todo/factory-winner-items', () => ({
  openFactoryWinnerRounds: async () => {
    h.order.push('open')
    if (h.openThrows) throw new Error('winner table unreadable')
    return h.openResult
  },
}))

import { GET } from '../route'

const req = () => new NextRequest('http://localhost/api/cron/pm-daily-todo', { headers: { authorization: 'Bearer s3cret' } })

beforeEach(() => {
  h.order.length = 0
  h.openResult = { opened: ['w1'], failed: [] }
  h.openThrows = false
  h.finish.mockClear()
  vi.stubEnv('CRON_SECRET', 's3cret')
  vi.stubEnv('RESEND_API_KEY', 'k')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('pm-daily-todo 开轮顺序', () => {
  it('先开轮、再读待办、最后发邮件；运行记录写开了几轮', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.order).toEqual(['open', 'load', 'send'])
    expect(h.finish).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ winner_rounds_opened: 1, winner_rounds_failed: 0 }),
    }))
  })

  it('开轮整步挂了 → 邮件照发，运行记录写失败数', async () => {
    h.openThrows = true
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.order).toEqual(['open', 'load', 'send'])
    expect(h.finish).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ winner_rounds_opened: 0, winner_rounds_failed: 1 }),
    }))
  })
})
