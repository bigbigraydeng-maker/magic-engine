/**
 * 断电记录的读写判据。
 *
 * 最要紧的两条：
 *   1. 「查不了」不许长得跟「一切正常」一样 —— 那正是这套东西存在的原因
 *   2. 恢复之后再犯，必须重新当作第 1 天报，不能被算成「老问题」而静默
 *
 * 读写都走窄函数接口（`OutageWriter` / `OutageReader`），所以这里不需要造
 * 任何假的 SupabaseClient —— 跟 `cron/health.ts` 的 `DownstreamProber` 同一条路子。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readRecentOutages,
  recordProviderOutage,
  resetOutageThrottle,
  shiftDate,
  shouldWriteNow,
  streakDays,
  utcDate,
  type OutageReadResult,
  type OutageRowInsert,
  type OutageWriteResult,
} from '../outage-ledger'

beforeEach(() => resetOutageThrottle())

describe('shouldWriteNow —— 进程内节流', () => {
  const t0 = new Date('2026-09-20T18:01:00Z')

  it('第一次写，之后 5 分钟内不再写', () => {
    expect(shouldWriteNow('openai', 'account_exhausted', t0)).toBe(true)
    expect(shouldWriteNow('openai', 'account_exhausted', new Date(t0.getTime() + 60_000))).toBe(false)
    expect(shouldWriteNow('openai', 'account_exhausted', new Date(t0.getTime() + 6 * 60_000))).toBe(true)
  })

  it('🔴 不同原因互不节流 —— 它们要人去的是不同的后台', () => {
    expect(shouldWriteNow('openai', 'account_exhausted', t0)).toBe(true)
    expect(shouldWriteNow('openai', 'gateway_auth_failed', t0)).toBe(true)
  })
})

describe('streakDays —— 连续断了几天', () => {
  it('今天有记录 → 从今天往回数', () => {
    expect(streakDays(['2026-09-23', '2026-09-22', '2026-09-21'], '2026-09-23')).toBe(3)
  })

  it('今天还没有记录、昨天有 → 从昨天数（当天的任务可能还没跑到）', () => {
    expect(streakDays(['2026-09-22', '2026-09-21'], '2026-09-23')).toBe(2)
  })

  it('中间断开就不算连续', () => {
    // 9/23、9/22 有，9/21 没有（那天充值了），9/20 又有 → 只数最近这一段
    expect(streakDays(['2026-09-23', '2026-09-22', '2026-09-20'], '2026-09-23')).toBe(2)
  })

  it('🔴 恢复之后再犯 = 重新算第 1 天（否则第二次断电会一声不吭）', () => {
    // 9/20 断 → 9/21 充值 → 9/25 又断。
    // 按「第一次出现到今天的天数差」算会得出 6，直接跳过提醒窗口；
    // 必须是 1，才会走「头几天每天提醒」那条路。
    expect(streakDays(['2026-09-20', '2026-09-25'], '2026-09-25')).toBe(1)
  })

  it('最近两天都没有记录 → 0（已经好了）', () => {
    expect(streakDays(['2026-09-20'], '2026-09-23')).toBe(0)
  })

  it('一条记录都没有 → 0', () => {
    expect(streakDays([], '2026-09-23')).toBe(0)
  })

  it('同一天重复出现不会把天数数多', () => {
    expect(streakDays(['2026-09-23', '2026-09-23', '2026-09-22'], '2026-09-23')).toBe(2)
  })
})

describe('utcDate / shiftDate', () => {
  it('按 UTC 日历天，跨月跨闰年都对', () => {
    expect(utcDate(new Date('2026-09-20T18:01:00Z'))).toBe('2026-09-20')
    expect(shiftDate('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2024-03-01', -1)).toBe('2024-02-29')
  })
})

describe('recordProviderOutage', () => {
  const now = new Date('2026-09-20T18:01:00Z')

  it('按「provider + reason + 哪一天」写一行', async () => {
    const written: OutageRowInsert[] = []
    const write = async (row: OutageRowInsert): Promise<OutageWriteResult> => {
      written.push(row)
      return { error: null }
    }
    await recordProviderOutage(write, {
      provider: 'openai', reason: 'account_exhausted', detail: 'no quota', now,
    })
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      provider: 'openai',
      reason: 'account_exhausted',
      outage_date: '2026-09-20',
    })
  })

  it('🔴 写失败绝不向调用方抛（不能把业务调用也弄挂），但必须喊一声', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const write = async (): Promise<OutageWriteResult> => ({
      error: { message: 'relation "provider_outages" does not exist' },
    })
    await expect(
      recordProviderOutage(write, { provider: 'openai', reason: 'account_exhausted', detail: 'x', now }),
    ).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/告警管道本身坏了/)
    spy.mockRestore()
  })

  it('细节被截断，不把一整页 HTML 塞进库', async () => {
    const written: OutageRowInsert[] = []
    const write = async (row: OutageRowInsert): Promise<OutageWriteResult> => {
      written.push(row)
      return { error: null }
    }
    await recordProviderOutage(write, {
      provider: 'openai', reason: 'account_exhausted', detail: 'x'.repeat(5000), now,
    })
    expect(written[0].detail.length).toBeLessThanOrEqual(500)
  })
})

describe('readRecentOutages', () => {
  const now = new Date('2026-09-23T19:00:00Z')

  it('查得到、确实没有 → rows 空、error 为 null（合法的「一切正常」）', async () => {
    const read = async (): Promise<OutageReadResult> => ({ rows: [], error: null })
    expect(await readRecentOutages(read, now)).toEqual({ rows: [], error: null })
  })

  it('🔴 查不了 → error 非空。绝不能跟「没有记录」混成同一个空数组', async () => {
    // 混了的话，「告警管道自己坏了」会长得跟「一切正常」一模一样
    const read = async (): Promise<OutageReadResult> => ({
      rows: null,
      error: { message: 'PGRST205 Could not find the table' },
    })
    const out = await readRecentOutages(read, now)
    expect(out.rows).toEqual([])
    expect(out.error).toMatch(/PGRST205/)
  })

  it('查询整个抛异常也归到 error，不静默', async () => {
    const read = async (): Promise<OutageReadResult> => {
      throw new Error('boom')
    }
    const out = await readRecentOutages(read, now)
    expect(out.error).toMatch(/boom/)
  })

  it('往回查的起始日按窗口天数算', async () => {
    let asked = ''
    const read = async (sinceDate: string): Promise<OutageReadResult> => {
      asked = sinceDate
      return { rows: [], error: null }
    }
    await readRecentOutages(read, now, 14)
    expect(asked).toBe('2026-09-09')
  })
})
