import { describe, it, expect } from 'vitest'
import {
  judgeAutoRun,
  AUTO_RUNNABLE_ACTION_TYPES,
  OUTWARD_ACTION_TYPES,
  NOT_AUTO_RUNNABLE_NEEDS_EXECUTOR,
  PRESCRIPTION_FRESH_DAYS,
} from './auto-run-policy'

import type { Endorsement } from './auto-run-policy'

/** 默认给「当前方案还认着 + 客户在服务中」—— 让原有用例专测安全闸那一层 */
const pending = (
  actionType: string | null,
  fixType: string | null = 'me_auto',
  endorsement: Endorsement = { kind: 'current_prescription', ageDays: 2 },
) => ({
  actionType,
  fixType,
  status: 'pending',
  clientStatus: 'active',
  weeklyBlogEnabled: true,
  pinnedTopic: null,
  endorsement,
})

describe('judgeAutoRun —— 白名单，认不出就停', () => {
  it('白名单里的、待办的、标着系统能做的 → 跑', () => {
    for (const t of AUTO_RUNNABLE_ACTION_TYPES) {
      expect(judgeAutoRun(pending(t)).run, t).toBe(true)
    }
  })

  it('🔴 认不出的类型一律不跑 —— 白名单的失败方式只是慢一天，黑名单的失败方式不可逆', () => {
    const v = judgeAutoRun(pending('some_new_thing_the_ai_invented'))
    expect(v.run).toBe(false)
    if (!v.run) expect(v.reason).toContain('还不会自己做')
  })

  it('🔴 对外/花钱的必须停，而且要说清是哪一种对外', () => {
    for (const [t, why] of Object.entries(OUTWARD_ACTION_TYPES)) {
      const v = judgeAutoRun(pending(t))
      expect(v.run, t).toBe(false)
      if (!v.run) {
        expect(v.reason).toContain(why)
        expect(v.reason).toContain('等你点头')
      }
    }
  })

  it('🔴 会发到客户商家页/社媒/网站的，一条都不许自动跑', () => {
    for (const t of ['publish_geo_directive', 'publish_geo_snippet', 'gbp_posts', 'launch_social_campaign']) {
      expect(judgeAutoRun(pending(t)).run, t).toBe(false)
    }
  })

  it('🔴 会开始花广告费的，一条都不许自动跑', () => {
    for (const t of ['launch_google_ads_campaign', 'expand_to_google_ads', 'refresh_meta_ad_creatives']) {
      expect(judgeAutoRun(pending(t)).run, t).toBe(false)
    }
  })

  it('🔴 没写动作类型的不跑 —— 那多半是方案里的阶段描述，不是一条指令', () => {
    // 库里真实存在的例子：「【DA Layer 2 待做】SourceBottle 注册 + 媒体投稿启动」
    // 「[C4] 第 1 周 7 篇 post 生成」—— 都标着 me_auto，但都是几周的人工项目
    for (const empty of [null, '', '   ']) {
      const v = judgeAutoRun(pending(empty))
      expect(v.run).toBe(false)
      if (!v.run) expect(v.reason).toContain('拆细')
    }
  })

  it('🔴 `me_auto` 这个标记只能否决、不能放行 —— 它自己就不可信', () => {
    // 真实数据：标着 me_auto 的待办里混着「Lighthouse 全站审计」这种人工项目。
    // 所以即使标了 me_auto，类型不在白名单里照样不跑。
    expect(judgeAutoRun(pending('audit', 'me_auto')).run).toBe(false)
    expect(judgeAutoRun(pending('design', 'me_auto')).run).toBe(false)
    expect(judgeAutoRun(pending('launch', 'me_auto')).run).toBe(false)
    // 反过来：在白名单里但人明确标了要手工做 → 不抢
    expect(judgeAutoRun(pending('generate_blog_post', 'fde_manual')).run).toBe(false)
    expect(judgeAutoRun(pending('generate_blog_post', 'third_party')).run).toBe(false)
  })

  it('只碰没人动过的 —— 进行中/已完成/已作废一律不碰', () => {
    for (const s of ['in_progress', 'completed', 'skipped', 'superseded']) {
      const v = judgeAutoRun({
        actionType: 'generate_blog_post', fixType: 'me_auto', status: s,
        clientStatus: 'active', weeklyBlogEnabled: true, pinnedTopic: null,
        endorsement: { kind: 'current_prescription', ageDays: 2 },
      })
      expect(v.run, s).toBe(false)
      if (!v.run) expect(v.reason).toContain('有人动过')
    }
  })

  it('🔴 白名单本身不许悄悄长胖 —— 每加一条都要重新想「它的产物访客看得到吗」', () => {
    // 这条是给未来改动的人看的：白名单变了这里就红，逼你重新过一遍入选标准。
    // ⚠️ 还要重新想第二件事：客户闸现在用的是 `seo_config.weekly_blog`，
    //    因为三种类型全是写博客。这里进了非博客类型，那道闸就名不副实了，
    //    必须同时拆开（比如按维度各配一个开关），不能沿用。
    expect([...AUTO_RUNNABLE_ACTION_TYPES].sort()).toEqual([
      'generate_blog_post',
      'generate_flooring_blog_post',
      'generate_seo_geo_blog_post',
    ])
  })

  it('🔴 seo.refresh_blog 不许在白名单里 —— 它没有执行器，接上去会自相残杀', () => {
    // 2026-08-05 移除。它不是一个动作，是 seo-patrol 四条规则（R1/R2/R3/R5）共用的
    // 一个标签，而全仓没有任何「刷新已有文章」的执行器。接到博客生成器上，
    // 「这个词掉排名了去刷新那篇」会变成「新写一篇打同一个词」，
    // 跟客户自己正在排名的页面抢位置 —— 而且是每周自动地做。
    expect([...AUTO_RUNNABLE_ACTION_TYPES]).not.toContain('seo.refresh_blog')
    expect([...NOT_AUTO_RUNNABLE_NEEDS_EXECUTOR]).toContain('seo.refresh_blog')
  })

  it('🔴 两个名单不许有交集 —— 一个类型不能既「能自动跑」又「缺执行器」', () => {
    for (const t of NOT_AUTO_RUNNABLE_NEEDS_EXECUTOR) {
      expect(
        (AUTO_RUNNABLE_ACTION_TYPES as readonly string[]).includes(t),
        `${t} 同时出现在两个名单里`,
      ).toBe(false)
    }
  })

  it('🔴 白名单和对外名单不许有交集 —— 有就是自相矛盾', () => {
    for (const t of AUTO_RUNNABLE_ACTION_TYPES) {
      expect(OUTWARD_ACTION_TYPES[t], `${t} 同时出现在两个名单里`).toBeUndefined()
    }
  })
})

describe('judgeAutoRun —— 「该不该做」排在「能不能做」前面', () => {
  const safe = {
    actionType: 'generate_blog_post',
    fixType: 'me_auto',
    status: 'pending',
    clientStatus: 'active',
    weeklyBlogEnabled: true,
    pinnedTopic: null,
  }

  it('🔴 不挂任何方案的一律不跑 —— 看板上 272 件里有 204 件是这种，最老的躺了快三个月', () => {
    const v = judgeAutoRun({ ...safe, endorsement: { kind: 'unendorsed', ageDays: 82 } })
    expect(v.run).toBe(false)
    if (!v.run) {
      expect(v.reason).toContain('不挂在任何方案下')
      expect(v.reason).toContain('82 天')
    }
  })

  it('🔴 完全没传背书信息时按「没有背书」处理 —— 缺省必须站在保守那边', () => {
    expect(judgeAutoRun(safe).run).toBe(false)
  })

  it('🔴 属于已被换掉的旧方案 → 不跑，让新一轮重新判断', () => {
    const v = judgeAutoRun({ ...safe, endorsement: { kind: 'stale_prescription' } })
    expect(v.run).toBe(false)
    if (!v.run) expect(v.reason).toContain('重新判断')
  })

  it('当前方案还认着 → 放行（其余闸门照常）', () => {
    expect(
      judgeAutoRun({ ...safe, endorsement: { kind: 'current_prescription', ageDays: 3 } }).run,
    ).toBe(true)
  })

  it('挂在还在跑的营销计划下也算数 —— 那是第二根有效的锚', () => {
    expect(
      judgeAutoRun({ ...safe, endorsement: { kind: 'current_marketing_plan', ageDays: 10 } }).run,
    ).toBe(true)
  })

  it('🔴 已结束/未批准的营销计划 → 不跑（库里 6-08 那批 33 件就是这种）', () => {
    const v = judgeAutoRun({ ...safe, endorsement: { kind: 'stale_marketing_plan' } })
    expect(v.run).toBe(false)
    if (!v.run) expect(v.reason).toContain('不补做')
  })

  it(`🔴 方案批下来超过 ${PRESCRIPTION_FRESH_DAYS} 天就不算「当前」—— 否则它是永久通行证`, () => {
    // 2026-08-05 实测：库里仅有的 2 件可跑动作，背后的方案是 69 天和 83 天前批的。
    // 同一套判断里分析产物只给 8 天，方案却无限期有效，那道闸等于没有。
    for (const age of [69, 83]) {
      const v = judgeAutoRun({ ...safe, endorsement: { kind: 'current_prescription', ageDays: age } })
      expect(v.run, `${age} 天`).toBe(false)
      if (!v.run) expect(v.reason).toContain('太久没复核')
    }
    // 边界：正好 45 天还算数，45 天零一点就不算
    expect(
      judgeAutoRun({ ...safe, endorsement: { kind: 'current_prescription', ageDays: PRESCRIPTION_FRESH_DAYS } }).run,
    ).toBe(true)
    expect(
      judgeAutoRun({ ...safe, endorsement: { kind: 'current_prescription', ageDays: PRESCRIPTION_FRESH_DAYS + 0.1 } }).run,
    ).toBe(false)
  })

  it('营销计划也有同一条保质期', () => {
    expect(
      judgeAutoRun({ ...safe, endorsement: { kind: 'current_marketing_plan', ageDays: 100 } }).run,
    ).toBe(false)
  })

  it('近期分析刚出的也算数', () => {
    expect(judgeAutoRun({ ...safe, endorsement: { kind: 'recent_analysis', ageDays: 1 } }).run).toBe(true)
  })

  it('🔴 分析结果过期了就不算数 —— 老判断不能当新授权用', () => {
    const v = judgeAutoRun({ ...safe, endorsement: { kind: 'recent_analysis', ageDays: 40 } })
    expect(v.run).toBe(false)
    if (!v.run) expect(v.reason).toContain('早过期了')
  })

  it('🔴 该不该做**先于**能不能做 —— 不该做的事，哪怕它安全也不做', () => {
    // 动作类型是白名单里最安全的那种，但没人认它 → 照样不跑
    const v = judgeAutoRun({ ...safe, endorsement: { kind: 'unendorsed', ageDays: 5 } })
    expect(v.run).toBe(false)
    if (!v.run) expect(v.reason).toContain('没有任何一轮分析说过它该做')
  })
})

describe('judgeAutoRun —— 客户闸排在所有判断之前', () => {
  const good = {
    actionType: 'generate_blog_post',
    fixType: 'me_auto',
    status: 'pending',
    clientStatus: 'active',
    weeklyBlogEnabled: true,
    pinnedTopic: null,
    endorsement: { kind: 'current_prescription' as const, ageDays: 1 },
  }

  it('🔴 潜客 / 已归档客户的看板一律不碰 —— 他们不是我们的客户', () => {
    for (const s of ['prospect', 'archived', 'paused', '']) {
      const v = judgeAutoRun({ ...good, clientStatus: s })
      expect(v.run, s).toBe(false)
      if (!v.run) expect(v.reason).toContain('不是在服务的状态')
    }
  })

  it('🔴 没开周更的客户不碰 —— 演示账号(DEMO)靠这道闸挡，client_status 拦不住它', () => {
    const v = judgeAutoRun({ ...good, weeklyBlogEnabled: false })
    expect(v.run).toBe(false)
    if (!v.run) expect(v.reason).toContain('没开每周内容')
  })

  it('🔴 客户闸比背书先判 —— 潜客身上挂着一份有效方案也照样不跑', () => {
    const v = judgeAutoRun({ ...good, clientStatus: 'prospect' })
    expect(v.run).toBe(false)
    // 说的必须是「这家公司不该被碰」，不能拿背书理由搪塞
    if (!v.run) expect(v.reason).toContain('非客户')
  })

  it('🔴 卡上点名了要打哪个词 → 停手叫人（我只会按数据自己挑题，会写歪）', () => {
    const v = judgeAutoRun({ ...good, pinnedTopic: 'spc flooring brisbane' })
    expect(v.run).toBe(false)
    if (!v.run) {
      expect(v.reason).toContain('spc flooring brisbane')
      expect(v.reason).toContain('这条你来点')
    }
  })

  it('没点名的照常跑', () => {
    expect(judgeAutoRun({ ...good, pinnedTopic: null }).run).toBe(true)
  })
})
