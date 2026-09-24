/**
 * 评估日口径（2026-09-24）——「昨天」必须按广告账户自己的时区算，
 * 跨时区客户取**最早**的那一天。
 *
 * 上游取数窗口（PR #1964）已经改成按账户时区要数据；判定 / 日报这一侧如果还按 UTC 算
 * 「昨天」，`lte(insight_date, …)` 就会把当天刚存进来的最新一天滤掉。这一组测试钉住的是
 * 两侧用同一个时区基准，以及跨时区客户的取舍方向。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const timezoneProbe = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      // resolveAccountTimezone(): .eq('ad_account_id', id).eq('level','account')
      //   .order('captured_at', …).limit(1) → { data: [{ timezone_name }] }
      select: () => {
        const eqs: unknown[] = []
        const chain = {
          eq: (...args: unknown[]) => { eqs.push(...args); return chain },
          order: () => ({ limit: () => timezoneProbe(...eqs) }),
        }
        return chain
      },
    }),
  },
}))

import { accountDayKey, accountYesterday, resolveClientEvaluationDate } from '../account-timezone'

/** 事故当时那一刻：UTC 17:00（cron 触发点），新西兰已经是 09-24 05:00（NZST = UTC+12）。 */
const CRON_FIRE = new Date('2026-09-23T17:00:00Z')

/**
 * 奥克兰和布里斯班「昨天」不是同一天的那一小段：UTC 12:00 时
 * 奥克兰（UTC+12）已跨到 09-24，布里斯班（UTC+10）还停在 09-23 22:00。
 */
const SPLIT_MOMENT = new Date('2026-09-23T12:00:00Z')

/** 账户 id → 时区；没登记的账户按「读不到」处理。 */
function accountsOn(byId: Record<string, string | null>) {
  timezoneProbe.mockImplementation((...eqs: unknown[]) => {
    const id = String(eqs[1])
    return { data: id in byId ? [{ timezone_name: byId[id] }] : [], error: null }
  })
}

beforeEach(() => {
  timezoneProbe.mockReset()
})

describe('accountYesterday', () => {
  it('cron 触发那一刻，奥克兰的「昨天」是 09-23，UTC 的是 09-22', () => {
    expect(accountYesterday('Pacific/Auckland', CRON_FIRE)).toBe('2026-09-23')
    expect(accountYesterday(null, CRON_FIRE)).toBe('2026-09-22')
  })

  it('UTC 以西的账户不会被推到未来的一天', () => {
    // UTC 已是 09-24 02:00，洛杉矶（PDT = UTC-7）还停在 09-23 19:00：
    // 最后一个跑完的自然日是 09-22。
    const t = new Date('2026-09-24T02:00:00Z')
    expect(accountYesterday('America/Los_Angeles', t)).toBe('2026-09-22')
    expect(accountDayKey('America/Los_Angeles', t)).toBe('2026-09-23')
  })
})

describe('resolveClientEvaluationDate', () => {
  it('单账户客户：用账户自己的时区，不是 UTC——这正是取数窗口存到的那一天', async () => {
    accountsOn({ act_1: 'Pacific/Auckland' })
    await expect(resolveClientEvaluationDate(['act_1'], CRON_FIRE)).resolves.toBe('2026-09-23')
  })

  it('🔴 跨时区客户取最早的那一天：落后的账户那天还没跑完，不能当整天用', async () => {
    accountsOn({ act_nz: 'Pacific/Auckland', act_au: 'Australia/Brisbane' })

    // 这一刻两边各自的「昨天」：奥克兰 09-23、布里斯班 09-22。
    expect(accountYesterday('Pacific/Auckland', SPLIT_MOMENT)).toBe('2026-09-23')
    expect(accountYesterday('Australia/Brisbane', SPLIT_MOMENT)).toBe('2026-09-22')

    // 体检按 client_id 聚合、不分账户，所以只能取两边都已跑完的那一天。
    await expect(resolveClientEvaluationDate(['act_nz', 'act_au'], SPLIT_MOMENT)).resolves.toBe('2026-09-22')
  })

  it('账户 id 去重：主账户同时出现在次账户清单里也只查一次时区', async () => {
    accountsOn({ act_1: 'Pacific/Auckland' })
    await resolveClientEvaluationDate(['act_1', 'act_1', null, undefined], CRON_FIRE)
    expect(timezoneProbe).toHaveBeenCalledTimes(1)
  })

  it('时区读不到 → 回落 UTC 的昨天（跟修复前行为一致，没有快照的账户不会更差）', async () => {
    accountsOn({})   // 该账户没有账户级快照
    await expect(resolveClientEvaluationDate(['act_new'], CRON_FIRE)).resolves.toBe('2026-09-22')
  })

  it('🔴 一个账户读不到时区，不能把整个客户拖回 UTC 口径（卫青复审 2026-09-24）', async () => {
    // 新绑的号，每 6 小时一次的设置快照还没为它写过账户级行。
    accountsOn({ act_nz: 'Pacific/Auckland' })   // act_new 查不到

    // 若把「读不到」当 UTC 参与取最早：17:00 UTC 跑时 UTC 的昨天是 09-22，
    // 必然赢过奥克兰的 09-23，整个客户静默退回修复前的口径。
    await expect(resolveClientEvaluationDate(['act_nz', 'act_new'], CRON_FIRE)).resolves.toBe('2026-09-23')
  })

  it('一个广告账户都没有 → UTC 的昨天，且不查库', async () => {
    await expect(resolveClientEvaluationDate([null, undefined], CRON_FIRE)).resolves.toBe('2026-09-22')
    expect(timezoneProbe).not.toHaveBeenCalled()
  })

  it('时区查询报错 / 抛异常都不往上抛——判定日不能因为读不到时区而整段挂掉', async () => {
    timezoneProbe.mockReturnValueOnce({ data: null, error: { message: 'boom' } })
    await expect(resolveClientEvaluationDate(['act_1'], CRON_FIRE)).resolves.toBe('2026-09-22')

    timezoneProbe.mockImplementationOnce(() => { throw new Error('connection reset') })
    await expect(resolveClientEvaluationDate(['act_1'], CRON_FIRE)).resolves.toBe('2026-09-22')
  })
})
