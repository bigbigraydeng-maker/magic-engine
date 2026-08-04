import { describe, it, expect } from 'vitest'
import {
  expectedIntervalHours,
  overdueThresholdHours,
  judgeJob,
  unhealthyJobs,
  type JobHealthInput,
} from './schedule'

const NOW = new Date('2026-08-03T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

describe('expectedIntervalHours —— 只认本仓真正用到的写法', () => {
  it('每 N 分钟', () => {
    expect(expectedIntervalHours('*/10 * * * *')).toBeCloseTo(1 / 6)
    expect(expectedIntervalHours('*/30 * * * *')).toBe(0.5)
  })

  it('每 N 小时', () => {
    expect(expectedIntervalHours('0 */6 * * *')).toBe(6)
  })

  it('每小时第 N 分钟（messenger / meta-leads 这样写，避开整点拥堵）', () => {
    expect(expectedIntervalHours('10 * * * *')).toBe(1)
    expect(expectedIntervalHours('25 * * * *')).toBe(1)
  })

  it('每天固定时刻', () => {
    expect(expectedIntervalHours('0 4 * * *')).toBe(24)
    expect(expectedIntervalHours('30 5 * * *')).toBe(24)
  })

  it('每周一次', () => {
    expect(expectedIntervalHours('0 3 * * 1')).toBe(7 * 24)
  })

  it('周一到周五（pm-daily-todo 就是这个）—— 按最坏间隔算，周末不误报', () => {
    // 0-4 = 周日到周四跑，周五周六不跑 → 最长间隔 3 天
    expect(expectedIntervalHours('0 19 * * 0-4')).toBe(3 * 24)
  })

  it('🔴 看不懂的一律返回 null，不猜一个数字糊过去', () => {
    expect(expectedIntervalHours('0 0 1 * *')).toBeNull()
    expect(expectedIntervalHours('乱写')).toBeNull()
    expect(expectedIntervalHours('* * * *')).toBeNull()
  })
})

describe('overdueThresholdHours —— 宽限', () => {
  it('高频任务有下限，不会因为几分钟延迟就报警', () => {
    // 每 10 分钟 × 2.5 = 25 分钟，太短 → 抬到 1.5 小时
    expect(overdueThresholdHours('*/10 * * * *')).toBe(1.5)
  })

  it('每天任务给到 60 小时才算逾期', () => {
    expect(overdueThresholdHours('0 4 * * *')).toBe(60)
  })
})

const base: JobHealthInput = {
  service: 'x', jobName: 'x', schedule: '0 4 * * *', lastRunAt: hoursAgo(2), logsRuns: true,
}

describe('judgeJob', () => {
  it('按时跑了 → ok', () => {
    expect(judgeJob(base, NOW).state).toBe('ok')
  })

  it('🔴 代码里没写运行记录 → blind，**不算 ok**', () => {
    // 把「看不见」当「没问题」正是工厂停摆 8 天没人发现的根因
    const h = judgeJob({ ...base, logsRuns: false }, NOW)
    expect(h.state).toBe('blind')
  })

  it('blind 优先于其它判定 —— 没记录时「多久没跑」本身就是无意义的', () => {
    const h = judgeJob({ ...base, logsRuns: false, lastRunAt: null }, NOW)
    expect(h.state).toBe('blind')
  })

  it('从来没跑过 → never_ran（没登记加入时间时按老规矩报）', () => {
    expect(judgeJob({ ...base, lastRunAt: null }, NOW).state).toBe('never_ran')
  })

  it('🔴 刚加进来、还没轮到第一次排班 → 算健康，不许报「从没跑过」', () => {
    // 2026-08-03 实测踩到：prescription-weekly 当天建好、下周二才第一次跑；
    // job-boards-weekly 上周一跑过但那时代码还没写运行记录。两个都健康，
    // 却都会被报成「从没跑过，多半是密钥没接上」——
    // 而那句诊断当晚就被证伪了：三个「从没跑过」里有两个密钥早就接着。
    // 误报成了常态，真出事那天也会被当噪音划掉。
    const h = judgeJob(
      { ...base, lastRunAt: null, registeredAt: new Date(NOW.getTime() - 3 * 3_600_000) },
      NOW,
    )
    expect(h.state).toBe('ok')
  })

  it('🔴 加进来够久了还是没跑过 → 该报就报，别把保护变成掩盖', () => {
    const h = judgeJob(
      { ...base, lastRunAt: null, registeredAt: new Date(NOW.getTime() - 60 * 86_400_000) },
      NOW,
    )
    expect(h.state).toBe('never_ran')
  })

  it('报「从没跑过」时要给出排查顺序，不能只甩一句猜测', () => {
    const h = judgeJob({ ...base, lastRunAt: null }, NOW)
    if (h.state === 'never_ran') {
      // 三种真实原因都要提到：服务不在/暂停、跑了但失败、成功但没记录
      expect(h.detail).toContain('暂停')
      expect(h.detail).toContain('失败')
      expect(h.detail).toContain('startCronRun')
    }
  })

  it('超过宽限期 → overdue，并说清楚差多久', () => {
    const h = judgeJob({ ...base, lastRunAt: hoursAgo(80) }, NOW)
    expect(h.state).toBe('overdue')
    if (h.state === 'overdue') {
      expect(h.hoursSince).toBeCloseTo(80)
      expect(h.detail).toContain('80.0 小时')
    }
  })

  it('刚过理论间隔但还在宽限内 → 仍是 ok（不天天误报）', () => {
    // 天天误报等于没有告警 —— 真出事那天也被淹掉
    expect(judgeJob({ ...base, lastRunAt: hoursAgo(30) }, NOW).state).toBe('ok')
  })

  it('看不懂的表达式 → 单独标出来让人看，不静默放行', () => {
    const h = judgeJob({ ...base, schedule: '0 0 1 * *' }, NOW)
    expect(h.state).toBe('unknown_schedule')
  })
})

describe('unhealthyJobs', () => {
  it('只留有问题的', () => {
    const out = unhealthyJobs([
      { ...base, service: '好的' },
      { ...base, service: '瞎的', logsRuns: false },
      { ...base, service: '没跑的', lastRunAt: null },
      { ...base, service: '逾期的', lastRunAt: hoursAgo(200) },
    ], NOW)
    expect(out.map((h) => h.service)).toEqual(['瞎的', '没跑的', '逾期的'])
  })

  it('全都健康时返回空 —— 没消息才真的是好消息', () => {
    expect(unhealthyJobs([base], NOW)).toEqual([])
  })
})
