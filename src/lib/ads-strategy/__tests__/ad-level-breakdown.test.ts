import { describe, it, expect } from 'vitest'
import {
  AD_INSIGHT_SELECT,
  adInsightRowFromDb,
  breakdownByParent,
  MIN_RESULTS_FOR_COMPARISON,
  DIVERGENCE_RATIO_THRESHOLD,
  type AdInsightRow,
} from '../ad-level-breakdown'

const row = (o: Partial<AdInsightRow> & { entityId: string }): AdInsightRow => ({
  entityName: o.entityId,
  parentId: 'C1',
  spend: 0,
  results: 0,
  impressions: 0,
  ...o,
})

describe('breakdownByParent', () => {
  it('把同一父级下的广告摊开，并算出各自单价', () => {
    const [p] = breakdownByParent([
      row({ entityId: 'A', spend: 50, results: 10, impressions: 1000 }),
      row({ entityId: 'B', spend: 60, results: 6, impressions: 900 }),
    ])
    expect(p.aggregate.spend).toBe(110)
    expect(p.aggregate.results).toBe(16)
    expect(p.aggregate.costPerResult).toBe(6.88)
    // 子项按花费降序：B 花 $60 排前面（$10/结果），A 花 $50 在后（$5/结果）
    expect(p.children.map(c => c.costPerResult)).toEqual([10, 5])
  })

  it('同一广告的多天记录先合并再比较', () => {
    const [p] = breakdownByParent([
      row({ entityId: 'A', spend: 10, results: 2, impressions: 100 }),
      row({ entityId: 'A', spend: 30, results: 4, impressions: 300 }),
    ])
    expect(p.children).toHaveLength(1)
    expect(p.children[0].spend).toBe(40)
    expect(p.children[0].results).toBe(6)
    expect(p.children[0].impressions).toBe(400)
  })

  it('广告改名后取最新的名字', () => {
    const [p] = breakdownByParent([
      row({ entityId: 'A', entityName: '旧名', spend: 10, results: 3 }),
      row({ entityId: 'A', entityName: '[停用·编造看房时间] 新名', spend: 10, results: 3 }),
    ])
    expect(p.children[0].entityName).toBe('[停用·编造看房时间] 新名')
  })

  // ── 核心：汇总骗人时必须说出来 ────────────────────────────────
  describe('汇总误导检测', () => {
    it('差异大于门槛 → divergent，并指名道姓点出最贵和最便宜', () => {
      const [p] = breakdownByParent([
        row({ entityId: 'cn', entityName: '中文·学区', spend: 50, results: 10 }),   // $5
        row({ entityId: 'en', entityName: '英文·价格', spend: 60, results: 4 }),    // $15
      ])
      expect(p.verdict).toBe('divergent')
      expect(p.divergenceRatio).toBe(3)
      expect(p.warning).toContain('中文·学区')
      expect(p.warning).toContain('英文·价格')
    })

    it('差异小于门槛 → uniform，不发警告', () => {
      const [p] = breakdownByParent([
        row({ entityId: 'A', spend: 50, results: 10 }),  // $5
        row({ entityId: 'B', spend: 42, results: 7 }),   // $6
      ])
      expect(p.verdict).toBe('uniform')
      expect(p.warning).toBeNull()
      expect(p.divergenceRatio).toBeNull()
    })

    it('恰好等于门槛倍数算 divergent（边界不放过）', () => {
      const [p] = breakdownByParent([
        row({ entityId: 'A', spend: 40, results: 10 }),  // $4
        row({ entityId: 'B', spend: 60, results: 10 }),  // $6 → 正好 1.5 倍
      ])
      expect(p.divergenceRatio).toBe(DIVERGENCE_RATIO_THRESHOLD)
      expect(p.verdict).toBe('divergent')
    })
  })

  // ── 样本不足的广告不能当对照组 ──────────────────────────────
  describe('样本量护栏', () => {
    it('结果数低于门槛的广告标 underpowered，且不参与倍数比较', () => {
      const [p] = breakdownByParent([
        row({ entityId: 'big',  spend: 90, results: 9, impressions: 4000 }),
        row({ entityId: 'tiny', spend: 3,  results: 1, impressions: 77 }),   // Meta 只给了 77 次展示
      ])
      const tiny = p.children.find(c => c.entityId === 'tiny')!
      expect(tiny.underpowered).toBe(true)
      // 只剩 1 条有效 → 不敢判断
      expect(p.verdict).toBe('insufficient')
      expect(p.divergenceRatio).toBeNull()
    })

    it('全是 0 结果的广告 → insufficient 而不是假装比出了结果', () => {
      const [p] = breakdownByParent([
        row({ entityId: 'A', spend: 20, results: 0, impressions: 500 }),
        row({ entityId: 'B', spend: 10, results: 0, impressions: 200 }),
      ])
      expect(p.verdict).toBe('insufficient')
      expect(p.children.every(c => c.costPerResult === null)).toBe(true)
      expect(p.aggregate.costPerResult).toBeNull()
    })

    it('MIN_RESULTS_FOR_COMPARISON 是包含边界（等于就算有效）', () => {
      const [p] = breakdownByParent([
        row({ entityId: 'A', spend: 30, results: MIN_RESULTS_FOR_COMPARISON }),
        row({ entityId: 'B', spend: 90, results: MIN_RESULTS_FOR_COMPARISON }),
      ])
      expect(p.children.every(c => c.underpowered)).toBe(false)
      expect(p.verdict).toBe('divergent')
    })
  })

  describe('分组与排序', () => {
    it('按 parent 分组，花钱多的父级排前面', () => {
      const res = breakdownByParent([
        row({ entityId: 'a1', parentId: 'small', spend: 10, results: 5 }),
        row({ entityId: 'b1', parentId: 'big',   spend: 99, results: 5 }),
      ])
      expect(res.map(p => p.parentId)).toEqual(['big', 'small'])
    })

    it('parentId 为 null 的广告不会被丢掉', () => {
      const res = breakdownByParent([row({ entityId: 'orphan', parentId: null, spend: 5, results: 1 })])
      expect(res).toHaveLength(1)
      expect(res[0].parentId).toBeNull()
      expect(res[0].children[0].entityId).toBe('orphan')
    })

    it('子项按花费降序，spendShare 加总为 1', () => {
      const [p] = breakdownByParent([
        row({ entityId: 'small', spend: 25, results: 5 }),
        row({ entityId: 'big',   spend: 75, results: 5 }),
      ])
      expect(p.children.map(c => c.entityId)).toEqual(['big', 'small'])
      expect(p.children[0].spendShare).toBe(0.75)
      expect(p.children.reduce((s, c) => s + c.spendShare, 0)).toBeCloseTo(1)
    })
  })

  // ── 真实回归：2026-08-04 那次误判 ─────────────────────────────
  it('回归：用 Roman 的真实数字，必须判定汇总具有误导性', () => {
    // 数字来自 ad_daily_insights，2026-07-27~08-02
    const [p] = breakdownByParent([
      row({ entityId: 'F',  entityName: 'Ad F · 中文 · Rangitoto 学区',  spend: 94.11, results: 13 }),
      row({ entityId: 'G',  entityName: 'Ad G · EN · Title+CCC',        spend: 72.05, results: 6 }),
      row({ entityId: 'D',  entityName: 'Ad D · By negotiation',        spend: 59.02, results: 5 }),
      row({ entityId: 'E2', entityName: 'Ad E2 · 三语 · 专测组',          spend: 19.85, results: 2 }),
      row({ entityId: 'A',  entityName: 'Ad A · Rangitoto zone hook',   spend: 27.83, results: 1 }),
    ])
    // 汇总看起来是一个还行的数字：$272.86 / 27 = $10.11
    expect(p.aggregate.costPerResult).toBeCloseTo(10.11, 1)
    // 但内部最便宜 $7.24（中文）vs 最贵 $12.01（英文），必须报警
    expect(p.verdict).toBe('divergent')
    expect(p.warning).toContain('中文')
    // 三语只有 2 个结果 —— 当初就是拿它当证据得出「三语便宜」的，必须被判定为样本不足
    const trilingual = p.children.find(c => c.entityId === 'E2')!
    expect(trilingual.underpowered).toBe(true)
  })
})

describe('读侧取列（G12：看板查了不存在的 date 列）', () => {
  // 形状照抄生产 ad_daily_insights 一行（2026-09-12 CTS level='ad'，只保留读侧用到的列）
  const prodRow = {
    client_id: 'c0000000-0000-0000-0000-000000000000',
    entity_id: '120249672615250307',
    entity_name: 'GC · Food · EN · Reborn · 20260908',
    parent_id: '120247480862390307',
    insight_date: '2026-09-12',
    spend: 1.84,
    impressions: 74,
    leads: 0,
    messaging_conversations: 0,
    results: 0,
  }

  it('取列用 insight_date，不含不存在的 date 列，并带上留资/私信两列', () => {
    const cols = AD_INSIGHT_SELECT.split(',').map(c => c.trim())
    expect(cols).toContain('insight_date')
    expect(cols).not.toContain('date')
    expect(cols).toContain('leads')
    expect(cols).toContain('messaging_conversations')
  })

  it('映射后留资/私信两列有值，单位不再退化成 unknown', () => {
    const r = adInsightRowFromDb(prodRow)
    expect(r.leads).toBe(0)
    expect(r.messagingConversations).toBe(0)
    const [p] = breakdownByParent([r])
    expect(p.children[0].resultUnit).toBe('none')
  })

  it('数据库列为 null 时保持 undefined（判 unknown），不伪造成 0', () => {
    const r = adInsightRowFromDb({ ...prodRow, leads: null, messaging_conversations: null })
    expect(r.leads).toBeUndefined()
    const [p] = breakdownByParent([r])
    expect(p.children[0].resultUnit).toBe('unknown')
  })

  it('接上两列后，表单广告与私信广告同组会被单位闸拦成 mixed_units', () => {
    const [p] = breakdownByParent([
      adInsightRowFromDb({ ...prodRow, entity_id: 'F', spend: 30, results: 5, leads: 5, messaging_conversations: 0 }),
      adInsightRowFromDb({ ...prodRow, entity_id: 'M', spend: 10, results: 5, leads: 0, messaging_conversations: 5 }),
    ])
    expect(p.verdict).toBe('mixed_units')
  })
})
