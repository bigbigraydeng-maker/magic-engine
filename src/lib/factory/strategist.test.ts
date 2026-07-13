// P21.J M1 — 策略决策核护栏测试(对照 spec §5.2 护栏总表)
import { describe, expect, it } from 'vitest'
import { decideSignal, maxNewClipsFor, normalizeAngle, pickFactoryGoal } from './strategist'
import type { DemandSignal, GateContext, GoalSlice } from './types'

function makeSignal(over: Partial<DemandSignal> = {}): DemandSignal {
  return {
    id: 'sig-1',
    client_id: 'c0000000-0000-0000-0000-000000000000',
    signal_type: 'creative_fatigue',
    source: 'cts-meta-ads-operator',
    dedupe_key: 'fatigue:act_x:ad_1:2026-07-11',
    confidence: 0.9,
    evidence: { ad_id: 'ad_1', metrics: { frequency: 2.8 } },
    request: { desired_variant_count: 2, notes: 'CPL climbing' },
    status: 'received',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: new Date().toISOString(),
    ...over,
  }
}

function makeCtx(over: Partial<GateContext> = {}): GateContext {
  return {
    now: new Date(),
    signal: makeSignal(),
    openOrderAdIds: [],
    brief: {
      id: 'brief-1',
      core_proposition: 'Trusted China tours for Kiwis',
      content_pillars: ['Best of China group tours', 'Silk Road adventure'],
      keyword_seeds: ['china tour from auckland'],
      excluded_topics: ['inbound tourism'],
    },
    goal: { id: 'goal-1', title: 'Leads growth', primary_metric_key: 'leads_count' },
    brandRedlines: ['Auckland since 1928'],
    recentAngles: [],
    blocklist: [],
    activeWinners: [],
    balanceUsd: 20,
    dailyOrderCount: 0,
    dailyCostUsd: 0,
    clipStock: [],
    allowBTrackLandmarkAds: true,
    verifiedOffer: null,
    ...over,
  }
}

describe('闸 0 · 时效 + 语义去重', () => {
  it('过期信号 → expired,不评估(魏征 F15)', () => {
    const ctx = makeCtx({ signal: makeSignal({ expires_at: new Date(Date.now() - 1000).toISOString() }) })
    expect(decideSignal(ctx)).toEqual({ outcome: 'expired' })
  })

  it('同 ad_id 已有开放工单 → duplicate_open_order(护栏 11)', () => {
    const ctx = makeCtx({ openOrderAdIds: ['ad_1'] })
    const d = decideSignal(ctx)
    expect(d.outcome).toBe('rejected')
    expect((d as { reason: string }).reason).toBe('duplicate_open_order')
  })
})

describe('闸 1 · 战略地基硬闸(fail-closed)', () => {
  it('红线查询失败(null)→ gate_data_unavailable,绝不放行(护栏 4)', () => {
    const d = decideSignal(makeCtx({ brandRedlines: null }))
    expect((d as { reason: string }).reason).toBe('gate_data_unavailable')
  })

  it('无 active brief → no_active_brief_or_goal(护栏 5)', () => {
    const d = decideSignal(makeCtx({ brief: null }))
    expect((d as { reason: string }).reason).toBe('no_active_brief_or_goal')
  })

  it('无 active goal → no_active_brief_or_goal(护栏 5)', () => {
    const d = decideSignal(makeCtx({ goal: null }))
    expect((d as { reason: string }).reason).toBe('no_active_brief_or_goal')
  })

  it('信号文本撞品牌红线(大小写不敏感)→ brand_redline_hit(护栏 3)', () => {
    const ctx = makeCtx({
      signal: makeSignal({ request: { notes: 'push the AUCKLAND SINCE 1928 heritage angle' } }),
    })
    const d = decideSignal(ctx)
    expect((d as { reason: string }).reason).toBe('brand_redline_hit')
  })

  it('信号文本撞 excluded_topics → excluded_topic_hit(护栏 3)', () => {
    const ctx = makeCtx({ signal: makeSignal({ request: { notes: 'target inbound tourism market' } }) })
    const d = decideSignal(ctx)
    expect((d as { reason: string }).reason).toBe('excluded_topic_hit')
  })
})

describe('闸 2 · 成本护栏', () => {
  it('余额 < $10 → balance_low 全线停机(护栏 10)', () => {
    const d = decideSignal(makeCtx({ balanceUsd: 9.99 }))
    expect((d as { reason: string }).reason).toBe('balance_low')
  })

  it('余额查询失败(null)→ gate_data_unavailable', () => {
    const d = decideSignal(makeCtx({ balanceUsd: null }))
    expect((d as { reason: string }).reason).toBe('gate_data_unavailable')
  })

  it('客户日工单 ≥3 → daily_order_cap(护栏 9)', () => {
    const d = decideSignal(makeCtx({ dailyOrderCount: 3 }))
    expect((d as { reason: string }).reason).toBe('daily_order_cap')
  })

  it('客户日成本 ≥$5 → daily_cost_cap(护栏 9)', () => {
    const d = decideSignal(makeCtx({ dailyCostUsd: 5 }))
    expect((d as { reason: string }).reason).toBe('daily_cost_cap')
  })

  it('预扣制硬数:$2 cap → 8 条 clip(护栏 8:2/1.1/0.225 向下取整)', () => {
    expect(maxNewClipsFor(2)).toBe(8)
    expect(maxNewClipsFor(0)).toBe(0)
  })
})

describe('角度溯源 + 去重(护栏 2/7)', () => {
  it('brief 无可溯源条目 → angle_not_traceable(板桥 #1 主闸)', () => {
    const d = decideSignal(
      makeCtx({
        brief: { id: 'b', core_proposition: null, content_pillars: [], keyword_seeds: [], excluded_topics: [] },
      }),
    )
    expect((d as { reason: string }).reason).toBe('angle_not_traceable')
  })

  it('全部候选角度均被去重/拉黑 → no_angle_available', () => {
    const ctx = makeCtx({
      brief: { id: 'b', core_proposition: null, content_pillars: ['Only pillar'], keyword_seeds: [], excluded_topics: [] },
      recentAngles: ['only pillar'],
    })
    const d = decideSignal(ctx)
    expect((d as { reason: string }).reason).toBe('no_angle_available')
  })

  it('首选角度撞 14 天去重 → 自动落到下一个可溯源角度(护栏 7)', () => {
    const d = decideSignal(makeCtx({ recentAngles: ['Best of China group tours'] }))
    expect(d.outcome).toBe('accepted')
    const wo = (d as { workOrder: { angle: string } }).workOrder
    expect(wo.angle).toBe('Silk Road adventure')
  })

  it('blocklist permanent 永不过期拦截(品牌红线类打回)', () => {
    const ctx = makeCtx({
      brief: { id: 'b', core_proposition: null, content_pillars: ['Only pillar'], keyword_seeds: [], excluded_topics: [] },
      blocklist: [{ angle: 'only pillar', permanent: true, expires_at: new Date(Date.now() - 86_400_000).toISOString() }],
    })
    expect((decideSignal(ctx) as { reason: string }).reason).toBe('no_angle_available')
  })

  it('防撞 active winner:题材撞车且 frequency ≤2.5 → 不做;>2.5 解锁续命(护栏 7)', () => {
    const winnerBase = {
      id: 'w1',
      hook_segment: { description: 'Best of China group tours' },
      middle_segment: {},
      cta_segment: {},
      win_reason_tags: ['scenery_first'],
      cost_per_thruplay: 0.01,
      status: 'active',
    }
    // new_campaign 强制 fresh angle(不挂骨架),避免 winner 被选为骨架
    const signal = makeSignal({ signal_type: 'new_campaign', evidence: { campaign_name: 'Spring Sale' } })
    const locked = decideSignal(
      makeCtx({ signal, activeWinners: [{ ...winnerBase, current_frequency: 2.0 }] }),
    )
    expect((locked as { workOrder: { angle: string } }).workOrder.angle).toBe('Silk Road adventure')

    const unlocked = decideSignal(
      makeCtx({ signal, activeWinners: [{ ...winnerBase, current_frequency: 3.0 }] }),
    )
    expect((unlocked as { workOrder: { angle: string } }).workOrder.angle).toBe('Best of China group tours')
  })
})

describe('骨架 + 工单组装', () => {
  it('有 active winner → variant_from_winner + 溯源指向骨架(§5.1 步骤 4)', () => {
    const d = decideSignal(
      makeCtx({
        activeWinners: [
          {
            id: 'w1',
            hook_segment: { description: 'price tag rip reveal' },
            middle_segment: {},
            cta_segment: {},
            win_reason_tags: ['price_hook'],
            cost_per_thruplay: 0.0148,
            current_frequency: 1.2,
            status: 'active',
          },
        ],
      }),
    )
    expect(d.outcome).toBe('accepted')
    const wo = (d as { workOrder: Record<string, unknown> }).workOrder as {
      order_type: string
      winner_structure_id: string
      angle_source: { type: string; ref_id: string }
    }
    expect(wo.order_type).toBe('variant_from_winner')
    expect(wo.winner_structure_id).toBe('w1')
    expect(wo.angle_source.type).toBe('winner_structure')
    expect(wo.angle_source.ref_id).toBe('w1')
  })

  it('new_campaign 缺 campaign_name → rationale_template_failed(护栏 19:说不出人话的工单不做)', () => {
    const d = decideSignal(
      makeCtx({ signal: makeSignal({ signal_type: 'new_campaign', evidence: {}, request: {} }) }),
    )
    expect((d as { reason: string }).reason).toBe('rationale_template_failed')
  })

  it('疲劳信号 happy path:rationale 带 frequency 数字 + 溯源 + 预扣硬数 + 生成计划', () => {
    const d = decideSignal(makeCtx())
    expect(d.outcome).toBe('accepted')
    const wo = (d as { workOrder: Record<string, unknown> }).workOrder as {
      rationale_one_liner: string
      angle_source: { type: string; ref_text: string }
      brief: { max_new_clips: number; clip_generation_plan: unknown[]; segments: unknown[] }
      goal_id: string
      master_brief_id: string
    }
    expect(wo.rationale_one_liner).toContain('2.8')
    expect(wo.angle_source.type).toBe('content_pillar')
    expect(wo.brief.max_new_clips).toBe(8)
    // 零库存 → 5 镜全部进 clip_generation_plan(§5.1 步骤 5;分镜方案 hook+3middle+cta)
    expect(wo.brief.clip_generation_plan).toHaveLength(5)
    expect(wo.brief.segments).toHaveLength(5)
    expect(wo.goal_id).toBe('goal-1')
    expect(wo.master_brief_id).toBe('brief-1')
  })

  it('有库存:冷素材优先挂载,不再进生成计划(护栏 1)', () => {
    const d = decideSignal(
      makeCtx({
        clipStock: [
          { id: 'clip-hot', scene_tag: 'great_wall', motion_type: 'push_in', track: 'a_real', usage_count: 5, last_used_at: null },
          { id: 'clip-cold', scene_tag: 'west_lake', motion_type: 'pull_back', track: 'a_real', usage_count: 0, last_used_at: null },
        ],
      }),
    )
    const wo = (d as { workOrder: { clip_links: Array<{ clip_id: string; segment_role: string }>; brief: { clip_generation_plan: unknown[] } } }).workOrder
    expect(wo.clip_links[0]).toMatchObject({ clip_id: 'clip-cold', segment_role: 'hook' })
    expect(wo.clip_links).toHaveLength(2) // 2 个不同场景 → 挂 2 镜
    expect(wo.brief.clip_generation_plan).toHaveLength(3) // 剩 3 镜(2 middle + cta)补生成
  })

  it('素材单一根治:同 scene_tag 多行只出镜一次,重复场景落生成计划(去重按内容不止 id)', () => {
    // 真实 bug 现场:Oztop bath1_factory 有 2 行(同源不同 id),旧代码只按 id 去重 → hook+middle 都选 bath = 成片单一。
    const d = decideSignal(
      makeCtx({
        clipStock: [
          { id: 'bath-a', scene_tag: 'bath1_factory', motion_type: null, track: 'a_real', usage_count: 0, last_used_at: null },
          { id: 'bath-b', scene_tag: 'bath1_factory', motion_type: null, track: 'a_real', usage_count: 0, last_used_at: null },
          { id: 'water', scene_tag: 'broll_water_tile', motion_type: null, track: 'a_real', usage_count: 0, last_used_at: null },
        ],
      }),
    )
    const wo = (d as { workOrder: { clip_links: Array<{ clip_id: string }>; brief: { clip_generation_plan: unknown[] } } }).workOrder
    // 只有 2 个 distinct 场景 → 只挂 2 镜,其余 3 镜落生成计划(不重复同一 bath 场景)
    expect(wo.clip_links).toHaveLength(2)
    expect(wo.brief.clip_generation_plan).toHaveLength(3)
    const sceneOf: Record<string, string> = { 'bath-a': 'bath1_factory', 'bath-b': 'bath1_factory', water: 'broll_water_tile' }
    const usedScenes = new Set(wo.clip_links.map((l) => sceneOf[l.clip_id]))
    expect(usedScenes.size).toBe(2) // 两条挂载 clip 必须来自不同场景
  })

  it('A/B 轨治理:B 轨地标 clip 默认排除;客户显式接受风险(CTS)才放行(护栏 6/附录 A)', () => {
    const bClip = { id: 'clip-b', scene_tag: 'great_wall', motion_type: null, track: 'b_generated' as const, usage_count: 0, last_used_at: null }
    const denied = decideSignal(makeCtx({ clipStock: [bClip], allowBTrackLandmarkAds: false }))
    expect((denied as { workOrder: { clip_links: unknown[] } }).workOrder.clip_links).toHaveLength(0)

    const allowed = decideSignal(makeCtx({ clipStock: [bClip], allowBTrackLandmarkAds: true }))
    expect((allowed as { workOrder: { clip_links: unknown[] } }).workOrder.clip_links).toHaveLength(1)
  })

  it('B 轨抽象氛围白名单 scene 不需要客户豁免(板桥 #8)', () => {
    const moodClip = { id: 'clip-m', scene_tag: 'sunset_mood', motion_type: null, track: 'b_generated' as const, usage_count: 0, last_used_at: null }
    const d = decideSignal(makeCtx({ clipStock: [moodClip], allowBTrackLandmarkAds: false }))
    expect((d as { workOrder: { clip_links: unknown[] } }).workOrder.clip_links).toHaveLength(1)
  })
})

describe('pickFactoryGoal — B0 Goal 圈定(诸葛亮红线:禁盲选最新)', () => {
  const goals: GoalSlice[] = [
    { id: 'g-newest', title: 'Leads', primary_metric_key: 'leads_count' },       // [0] 最新
    { id: 'g-brand', title: '品牌搜索', primary_metric_key: 'brand_search_volume' },
  ]
  it('config 命中 active goal → 用圈定的(不是最新)', () => {
    expect(pickFactoryGoal('g-brand', goals)?.id).toBe('g-brand')
  })
  it('config 指向的 goal 不在 active 列表(归档/换客户) → 退回最新', () => {
    expect(pickFactoryGoal('g-archived', goals)?.id).toBe('g-newest')
  })
  it('configGoalId 非 string(null/数字/对象) → 退回最新', () => {
    expect(pickFactoryGoal(null, goals)?.id).toBe('g-newest')
    expect(pickFactoryGoal(123, goals)?.id).toBe('g-newest')
    expect(pickFactoryGoal({}, goals)?.id).toBe('g-newest')
  })
  it('无任何 active goal → null(gate1 会因此拒单)', () => {
    expect(pickFactoryGoal('g-brand', [])).toBeNull()
    expect(pickFactoryGoal(null, [])).toBeNull()
  })
})

describe('normalizeAngle', () => {
  it('大小写/空白归一', () => {
    expect(normalizeAngle('  Best  of CHINA  ')).toBe('best of china')
  })
})

describe('魏征 M1 评审修复回归', () => {
  it('F11:asset_gap 只出 clip 生成工单——不挂既有 clip、scene 取自 evidence、溯源 inventory_gap', () => {
    const d = decideSignal(
      makeCtx({
        signal: makeSignal({
          signal_type: 'asset_gap',
          evidence: { scene_tag: 'great_wall' },
          request: { desired_variant_count: 2 },
        }),
        clipStock: [
          { id: 'clip-a', scene_tag: 'great_wall', motion_type: null, track: 'a_real', usage_count: 0, last_used_at: null },
        ],
      }),
    )
    expect(d.outcome).toBe('accepted')
    const wo = (d as { workOrder: Record<string, unknown> }).workOrder as {
      order_type: string
      angle: string
      angle_source: { type: string; ref_text: string }
      clip_links: unknown[]
      brief: { segments: unknown[]; clip_generation_plan: Array<{ scene_tag: string }> }
    }
    expect(wo.order_type).toBe('clip_generation')
    expect(wo.angle).toBe('asset_gap:great_wall')
    expect(wo.angle_source.type).toBe('inventory_gap')
    expect(wo.clip_links).toHaveLength(0)
    expect(wo.brief.segments).toHaveLength(0)
    expect(wo.brief.clip_generation_plan).toHaveLength(2)
    expect(wo.brief.clip_generation_plan[0].scene_tag).toBe('great_wall')
  })

  it('F11:asset_gap 缺 evidence.scene_tag → reject(不出无的放矢的工单)', () => {
    const d = decideSignal(makeCtx({ signal: makeSignal({ signal_type: 'asset_gap', evidence: {} }) }))
    expect((d as { reason: string }).reason).toBe('rationale_template_failed')
  })

  it('F8:brief 条目自身踩红线 → 跳过该候选落到下一个(角度会内插进客户可见叙事)', () => {
    const d = decideSignal(
      makeCtx({
        brief: {
          id: 'b',
          core_proposition: null,
          content_pillars: ['Heritage — Auckland since 1928', 'Silk Road adventure'],
          keyword_seeds: [],
          excluded_topics: [],
        },
      }),
    )
    expect(d.outcome).toBe('accepted')
    expect((d as { workOrder: { angle: string } }).workOrder.angle).toBe('Silk Road adventure')
  })

  it('F12:scene_tag 匹配角度的素材优先于更冷的无关素材(防货不对题)', () => {
    const d = decideSignal(
      makeCtx({
        recentAngles: ['Best of China group tours'], // 逼角度落到 Silk Road adventure
        clipStock: [
          { id: 'clip-cold-unrelated', scene_tag: 'shop_interior', motion_type: null, track: 'a_real', usage_count: 0, last_used_at: null },
          { id: 'clip-silk', scene_tag: 'silk_road_desert', motion_type: null, track: 'a_real', usage_count: 9, last_used_at: null },
        ],
      }),
    )
    const wo = (d as { workOrder: { clip_links: Array<{ clip_id: string; segment_role: string }> } }).workOrder
    expect(wo.clip_links[0]).toMatchObject({ clip_id: 'clip-silk', segment_role: 'hook' })
  })

  it('F2:accepted 工单携带 source_ad_id(护栏 11 直查本表的地基)', () => {
    const d = decideSignal(makeCtx())
    expect((d as { workOrder: { source_ad_id: string } }).workOrder.source_ad_id).toBe('ad_1')
  })
})

describe('实库形状兼容', () => {
  it('content_pillars 为 jsonb 对象数组({id,name,description})时用 name 溯源(2026-07-11 实库验证)', () => {
    const d = decideSignal(
      makeCtx({
        brief: {
          id: 'brief-1',
          core_proposition: null,
          content_pillars: [
            { id: 'destination_inspiration', name: 'Destination Inspiration', description: 'Visually-led content', post_ratio: 0.35 },
          ],
          keyword_seeds: [],
          excluded_topics: [],
        },
      }),
    )
    expect(d.outcome).toBe('accepted')
    const wo = (d as { workOrder: { angle: string; angle_source: { ref_id: string; ref_text: string } } }).workOrder
    expect(wo.angle).toBe('Destination Inspiration')
    expect(wo.angle_source.ref_id).toBe('content_pillars.destination_inspiration')
    expect(wo.angle_source.ref_text).toBe('Destination Inspiration')
  })

  it('对象缺 name → 跳过该条目,无候选则 angle_not_traceable', () => {
    const d = decideSignal(
      makeCtx({
        brief: {
          id: 'b',
          core_proposition: null,
          content_pillars: [{ id: 'x', description: 'no name' }],
          keyword_seeds: [],
          excluded_topics: [],
        },
      }),
    )
    expect((d as { reason: string }).reason).toBe('angle_not_traceable')
  })
})

describe('修复作品根因 · 选片按来源 + 角度不用竞品词', () => {
  it('选片:真实产品片(track=a_real)优先于 AI(b_generated),按来源判非文件名', () => {
    // AI 片 scene_tag 看着更"产品"(oz_kitchen),真拍片中性名——只按 track 判。变异:去掉 track 排序 → 原序 'ai' 先 → fail
    const d = decideSignal(
      makeCtx({
        clipStock: [
          { id: 'ai', scene_tag: 'oz_kitchen_1', motion_type: null, track: 'b_generated', usage_count: 0, last_used_at: null },
          { id: 'real', scene_tag: 'clip_zzz', motion_type: null, track: 'a_real', usage_count: 0, last_used_at: null },
        ],
      }),
    )
    const wo = (d as { workOrder: { clip_links: Array<{ clip_id: string }> } }).workOrder
    expect(wo.clip_links[0].clip_id).toBe('real') // a_real 先挂,AI 沉后
  })

  it('pickAngle 不拿 keyword_seeds 当广告角度(竞品名不当自家角度)', () => {
    // brief 只有 keyword_seeds(含竞品名 mapei/karndean)→ 无可溯源广告角度。变异:仍用 keyword_seeds → accepted → fail
    const d = decideSignal(
      makeCtx({
        brief: { id: 'b', core_proposition: null, content_pillars: [], keyword_seeds: ['mapei brisbane', 'karndean brisbane'], excluded_topics: [] },
      }),
    )
    expect((d as { reason: string }).reason).toBe('angle_not_traceable')
  })
})
