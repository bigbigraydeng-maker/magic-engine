/**
 * 「跑成了但没写出东西」的判据 —— 2026-09-23 事故对应的病态。
 *
 * `google-data-pullback-daily` 每天 status='completed'，但下游 `ad_health_narratives`
 * 从 9/20 起一行没写（上游数据源断了 → 路由里写这一步被跳过）。旧 `judgeJob`
 * 只看 cron_run_logs 状态放行，断了 3 天没人察觉。
 *
 * 只对 registry 里声明了 outputTables 的条目做检查；一表一 SilentSuccess。
 *
 * 依赖注入：checkDownstreamFreshness 接收 DownstreamProber 函数（不是 supabase
 * 客户端），测试直接传 fake 函数 —— 完全避开造大类型的 SupabaseClient 假货这个
 * 老大难问题。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  checkDownstreamFreshness,
  type DownstreamProbe,
  type DownstreamProber,
  type RunActivityProbe,
  type RunActivityReader,
} from './health'
import type { CronOutputTable } from './registry'

const NOW = new Date('2026-09-23T09:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

/** 建一个按表名返回不同结果的 fake prober，测试时直接传给 checkDownstreamFreshness。 */
function proberOf(byTable: Record<string, DownstreamProbe>): DownstreamProber {
  return async (target: CronOutputTable): Promise<DownstreamProbe> => {
    return byTable[target.table] ?? { lastRowAt: null, error: null }
  }
}

/** 建一个固定返回同一个结果的 fake activity reader，不看 jobName / since。 */
function activityReaderOf(probe: RunActivityProbe): RunActivityReader {
  return async () => probe
}

// 单独 mock registry 让测试不受它变化影响
vi.mock('./registry', async () => {
  const actual = await vi.importActual<typeof import('./registry')>('./registry')
  return {
    ...actual,
    CRON_REGISTRY: [
      {
        service: 'silent-success-fixture',
        jobName: 'silent-success-fixture',
        schedule: '0 3 * * *',
        logsRuns: true,
        outputTables: [
          // 🔴 一张声明空轮豁免、一张**故意不声明** —— 空轮豁免只对声明过的表生效
          //    （Codex 2026-09-23 P2：`processed=0` 在不同任务里不是同一个意思）。
          //    `ad_daily_insights` 这张守的就是反面：复刻 google-data-pullback-daily，
          //    它数据源断线时也会以 `processed: 0` + `completed` 收尾，
          //    豁免要是无条件生效，就会把断线又藏一次 —— 而那正是加这套判据要抓的事故。
          { table: 'ad_health_narratives', freshnessHours: 26, emptyRoundsAreLegitimate: true } satisfies CronOutputTable,
          { table: 'ad_daily_insights', freshnessHours: 26 } satisfies CronOutputTable,
        ],
      },
      // 一个没声明 outputTables 的条目 —— 不该被查
      {
        service: 'no-downstream-fixture',
        jobName: 'no-downstream-fixture',
        schedule: '0 4 * * *',
        logsRuns: true,
      },
    ] as const,
  }
})

describe('checkDownstreamFreshness —— 2026-09-23 事故防御', () => {
  it('下游超阈值没新行 → 报 silent_success，detail 说人话', async () => {
    const out = await checkDownstreamFreshness(proberOf({
      ad_health_narratives: { lastRowAt: hoursAgo(72), error: null },  // 3 天前
      ad_daily_insights:    { lastRowAt: hoursAgo(72), error: null },
    }), NOW)
    expect(out).toHaveLength(2)
    const nar = out.find((s) => s.table === 'ad_health_narratives')!
    expect(nar.hoursSince).toBeCloseTo(72, 0)
    expect(nar.detail).toContain('72')
    expect(nar.detail).toContain('阈值 26h')
  })

  it('下游 1 小时前刚写过 → 不报（这是健康状态）', async () => {
    const out = await checkDownstreamFreshness(proberOf({
      ad_health_narratives: { lastRowAt: hoursAgo(1), error: null },
      ad_daily_insights:    { lastRowAt: hoursAgo(1), error: null },
    }), NOW)
    expect(out).toEqual([])
  })

  it('下游边界：25h 不报，27h 报（阈值 26h）', async () => {
    const under = await checkDownstreamFreshness(proberOf({
      ad_health_narratives: { lastRowAt: hoursAgo(25), error: null },
      ad_daily_insights:    { lastRowAt: hoursAgo(25), error: null },
    }), NOW)
    expect(under).toEqual([])

    const over = await checkDownstreamFreshness(proberOf({
      ad_health_narratives: { lastRowAt: hoursAgo(27), error: null },
      ad_daily_insights:    { lastRowAt: hoursAgo(27), error: null },
    }), NOW)
    expect(over).toHaveLength(2)
  })

  it('下游一行都没有 → 报「从没写过」，不当健康糊弄过去', async () => {
    const out = await checkDownstreamFreshness(proberOf({
      ad_health_narratives: { lastRowAt: null, error: null },
      ad_daily_insights:    { lastRowAt: hoursAgo(1), error: null },
    }), NOW)
    expect(out).toHaveLength(1)
    expect(out[0].table).toBe('ad_health_narratives')
    expect(out[0].lastRowAt).toBeNull()
    expect(out[0].hoursSince).toBeNull()
    expect(out[0].detail).toContain('一行都没有')
  })

  it('🔴 查询出错单独报，不能默认当成 stale（跟 blind vs never_ran 同一个道理）', async () => {
    const out = await checkDownstreamFreshness(proberOf({
      ad_health_narratives: { lastRowAt: null, error: 'relation does not exist' },
      ad_daily_insights:    { lastRowAt: hoursAgo(1), error: null },
    }), NOW)
    expect(out).toHaveLength(1)
    expect(out[0].detail).toContain('无法查')
    expect(out[0].detail).toContain('relation does not exist')
    // 查询出错时 hoursSince 应为 null，不能算出一个数字来
    expect(out[0].hoursSince).toBeNull()
  })

  it('未声明 outputTables 的条目一律不查（跟老行为一致）', async () => {
    // prober 传空，如果 no-downstream-fixture 被查了就会返回默认 {lastRowAt:null,error:null}
    // → 应作为 "从没写过" 报出，但它没声明 outputTables，就一条不该出现
    const out = await checkDownstreamFreshness(proberOf({}), NOW)
    expect(out.map((s) => s.service)).not.toContain('no-downstream-fixture')
  })
})

describe('checkDownstreamFreshness × activityReader —— Codex 2026-09-23 复审：空轮次不能报', () => {
  it('窗口内没有 processed>0 的运行（一直是 nothing_due）→ 表再 stale 也不报', async () => {
    const out = await checkDownstreamFreshness(
      proberOf({
        // 只让**声明了空轮豁免**的那张 stale；另一张保持新鲜。
        // （`ad_daily_insights` 故意没声明豁免，见上面 fixture 的注释 ——
        //  它 stale 的话本来就该报，那是另一条测试的事。）
        ad_health_narratives: { lastRowAt: hoursAgo(72), error: null },
        ad_daily_insights: { lastRowAt: hoursAgo(1), error: null },
      }),
      NOW,
      activityReaderOf({ hadDueWork: false, error: null }),
    )
    expect(out).toEqual([])
  })

  it('窗口内有一次 processed>0（真的有候选）但表还是 stale → 照样报', async () => {
    const out = await checkDownstreamFreshness(
      proberOf({
        ad_health_narratives: { lastRowAt: hoursAgo(72), error: null },
        ad_daily_insights: { lastRowAt: hoursAgo(72), error: null },
      }),
      NOW,
      activityReaderOf({ hadDueWork: true, error: null }),
    )
    expect(out).toHaveLength(2)
  })

  it('从没写过 + 窗口内没有 processed>0 的运行 → 不报（表还没等到第一批候选）', async () => {
    const out = await checkDownstreamFreshness(
      proberOf({
        ad_health_narratives: { lastRowAt: null, error: null },
        ad_daily_insights: { lastRowAt: hoursAgo(1), error: null },
      }),
      NOW,
      activityReaderOf({ hadDueWork: false, error: null }),
    )
    expect(out).toEqual([])
  })

  it('activityReader 查询出错 → 不默认放行，按老行为照样报', async () => {
    const out = await checkDownstreamFreshness(
      proberOf({
        ad_health_narratives: { lastRowAt: hoursAgo(72), error: null },
        ad_daily_insights: { lastRowAt: hoursAgo(72), error: null },
      }),
      NOW,
      activityReaderOf({ hadDueWork: false, error: 'cron_run_logs 查询超时' }),
    )
    expect(out).toHaveLength(2)
  })

  it('不传 activityReader → 保持老行为（不做本轮是否应产出的判断）', async () => {
    const out = await checkDownstreamFreshness(
      proberOf({
        ad_health_narratives: { lastRowAt: hoursAgo(72), error: null },
        ad_daily_insights: { lastRowAt: hoursAgo(72), error: null },
      }),
      NOW,
    )
    expect(out).toHaveLength(2)
  })
})

/**
 * Codex 2026-09-23 复审 P2：空轮豁免必须是**任务级显式声明**，不能无条件套用。
 *
 * `processed=0` 在不同任务里不是同一个意思 —— `google-data-pullback-daily` 在读客户
 * Meta 账户报错时会忽略错误、得到空 work，然后以 `processed: 0` + `completed` 收尾。
 * 无条件豁免会把它数据源断线这件事再藏一次，而那正是当初加这套判据要抓的事故。
 */
describe('空轮豁免只对声明过的任务生效', () => {
  it('🔴 没声明豁免的那张表：即使窗口里全是 processed=0，stale 照样要报', async () => {
    const found = await checkDownstreamFreshness(
      proberOf({
        ad_health_narratives: { lastRowAt: hoursAgo(72), error: null },
        ad_daily_insights: { lastRowAt: hoursAgo(72), error: null },
      }),
      NOW,
      async () => ({ hadDueWork: false, error: null }),
    )
    // 声明了豁免的那张被抑制，没声明的那张必须还在 —— 否则断线又被藏回去了
    expect(found.map((f) => f.table)).toEqual(['ad_daily_insights'])
  })

  it('声明了豁免的任务：窗口里全是 processed=0 就不报（合法空轮）', async () => {
    const found = await checkDownstreamFreshness(
      proberOf({ ad_health_narratives: { lastRowAt: hoursAgo(72), error: null } }),
      NOW,
      async () => ({ hadDueWork: false, error: null }),
    )
    expect(found.filter((f) => f.table === 'ad_health_narratives')).toHaveLength(0)
  })
})
